package com.haulagefinance.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.MeteringRectangle;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Size;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Live viewfinder for Scan with camera. WebView getUserMedia keeps the
 * picture the driver sees, and that stream often never focuses at receipt
 * distance. This draws the back camera behind the same amber frame, with
 * continuous autofocus and a centre (or tap) trigger.
 *
 * <p>Does not grant or deny RESOURCE_VIDEO_CAPTURE.
 */
class ScanCameraPreview {
    private static final long OPEN_WAIT_MS = 1200;
    private static final int MAX_PREVIEW_EDGE = 1920;

    private final MainActivity activity;
    private final HandlerThread thread;
    private final Handler handler;

    private FrameLayout overlay;
    private TextureView texture;
    private FrameOverlay frameOverlay;
    private TextView hint;
    private CameraDevice device;
    private CameraCaptureSession session;
    private CaptureRequest.Builder previewRequest;
    private Surface previewSurface;
    private ImageReader stillReader;
    private CameraCharacteristics characteristics;
    private Size previewSize;
    private String pendingJpeg = "";
    private String frameMode = "a4";
    private boolean open;

    ScanCameraPreview(MainActivity activity) {
        this.activity = activity;
        thread = new HandlerThread("scan-camera-preview");
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    void shutdown() {
        stop();
        thread.quitSafely();
    }

    boolean isOpen() {
        return open;
    }

    String start(double focusX, double focusY, String mode) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            return "";
        }
        frameMode = mode == null ? "a4" : mode;
        CountDownLatch done = new CountDownLatch(1);
        String[] result = { "" };
        handler.post(() -> {
            try {
                closeCamera();
                result[0] = openSession(clamp01(focusX), clamp01(focusY));
            } catch (RuntimeException ignored) {
                result[0] = "";
            } finally {
                done.countDown();
            }
        });
        try {
            if (!done.await(2500, TimeUnit.MILLISECONDS)) return "";
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            return "";
        }
        return result[0] == null ? "" : result[0];
    }

    void refocus(double focusX, double focusY) {
        if (!open) return;
        handler.post(() -> triggerFocus(clamp01(focusX), clamp01(focusY)));
    }

    void setFrameMode(String mode) {
        frameMode = mode == null ? "a4" : mode;
        activity.runOnUiThread(() -> {
            if (frameOverlay != null) frameOverlay.setMode(frameMode);
            if (hint != null) hint.setText(hintFor(frameMode));
        });
        refocus(0.5, 0.46);
    }

    String takePreviewJpeg() {
        String value = pendingJpeg;
        pendingJpeg = "";
        return value == null ? "" : value;
    }

    void stop() {
        open = false;
        handler.post(this::closeCamera);
        activity.runOnUiThread(this::removeOverlay);
    }

    private String openSession(double focusX, double focusY) {
        if (!attachOverlay()) return "";
        CameraManager manager = (CameraManager) activity.getSystemService(MainActivity.CAMERA_SERVICE);
        if (manager == null) {
            stop();
            return "";
        }
        String id = backCameraId(manager);
        if (id == null) {
            stop();
            return "";
        }
        try {
            characteristics = manager.getCameraCharacteristics(id);
        } catch (CameraAccessException ignored) {
            stop();
            return "";
        }
        StreamConfigurationMap map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null || texture == null || texture.getSurfaceTexture() == null) {
            stop();
            return "";
        }
        previewSize = choosePreviewSize(map.getOutputSizes(SurfaceTexture.class), texture.getWidth(), texture.getHeight());
        texture.getSurfaceTexture().setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
        previewSurface = new Surface(texture.getSurfaceTexture());
        stillReader = ImageReader.newInstance(previewSize.getWidth(), previewSize.getHeight(), ImageFormat.JPEG, 1);
        device = openCamera(manager, id);
        if (device == null) {
            stop();
            return "";
        }
        session = createSession(device, Arrays.asList(previewSurface, stillReader.getSurface()));
        if (session == null) {
            stop();
            return "";
        }
        try {
            previewRequest = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            previewRequest.addTarget(previewSurface);
            applyAf(previewRequest, focusX, focusY, false);
            session.setRepeatingRequest(previewRequest.build(), null, handler);
            triggerFocus(focusX, focusY);
        } catch (CameraAccessException ignored) {
            stop();
            return "";
        }
        activity.runOnUiThread(() -> fitPreview(texture, previewSize));
        open = true;
        return "ok";
    }

    private void triggerFocus(double focusX, double focusY) {
        if (session == null || device == null || previewRequest == null || texture == null) return;
        try {
            applyAf(previewRequest, focusX, focusY, false);
            session.setRepeatingRequest(previewRequest.build(), null, handler);
            if (previewSurface == null) return;
            CaptureRequest.Builder trigger = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            trigger.addTarget(previewSurface);
            applyAf(trigger, focusX, focusY, true);
            session.capture(trigger.build(), null, handler);
        } catch (CameraAccessException | RuntimeException ignored) {
            // The repeating preview stays up.
        }
    }

    private void shutter() {
        handler.post(() -> {
            triggerFocus(0.5, 0.46);
            try {
                Thread.sleep(450);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return;
            }
            String jpeg = captureStill();
            if (jpeg == null || jpeg.isEmpty()) {
                activity.runOnUiThread(() -> {
                    if (hint != null) hint.setText("Could not focus. Tap the receipt and try the shutter again.");
                });
                return;
            }
            pendingJpeg = jpeg;
            eval("window.haulageNativePreview&&window.haulageNativePreview.deliver()");
        });
    }

    private String captureStill() {
        if (device == null || session == null || stillReader == null) return "";
        byte[][] box = new byte[1][];
        CountDownLatch latch = new CountDownLatch(1);
        stillReader.setOnImageAvailableListener(reader -> {
            Image image = null;
            try {
                image = reader.acquireNextImage();
                if (image == null) return;
                ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                byte[] data = new byte[buffer.remaining()];
                buffer.get(data);
                box[0] = data;
            } catch (RuntimeException ignored) {
                box[0] = null;
            } finally {
                if (image != null) image.close();
                latch.countDown();
            }
        }, handler);
        try {
            CaptureRequest.Builder still = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            still.addTarget(stillReader.getSurface());
            applyAf(still, 0.5, 0.46, false);
            still.set(CaptureRequest.JPEG_QUALITY, (byte) 92);
            session.capture(still.build(), null, handler);
            if (!latch.await(1500, TimeUnit.MILLISECONDS) || box[0] == null) return "";
            return Base64.encodeToString(cropToFrame(box[0]), Base64.NO_WRAP);
        } catch (CameraAccessException | InterruptedException ignored) {
            return "";
        }
    }

    private byte[] cropToFrame(byte[] jpeg) {
        Bitmap bitmap = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
        if (bitmap == null || frameOverlay == null) return jpeg;
        RectF frame = frameOverlay.frameFraction();
        int x = Math.max(0, Math.min(bitmap.getWidth() - 1, Math.round(frame.left * bitmap.getWidth())));
        int y = Math.max(0, Math.min(bitmap.getHeight() - 1, Math.round(frame.top * bitmap.getHeight())));
        int w = Math.max(1, Math.min(bitmap.getWidth() - x, Math.round(frame.width() * bitmap.getWidth())));
        int h = Math.max(1, Math.min(bitmap.getHeight() - y, Math.round(frame.height() * bitmap.getHeight())));
        Bitmap cropped = Bitmap.createBitmap(bitmap, x, y, w, h);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        cropped.compress(Bitmap.CompressFormat.JPEG, 92, out);
        if (cropped != bitmap) cropped.recycle();
        bitmap.recycle();
        return out.toByteArray();
    }

    private boolean attachOverlay() {
        CountDownLatch latch = new CountDownLatch(1);
        boolean[] ready = { false };
        activity.runOnUiThread(() -> {
            removeOverlay();
            WebView webView = activity.scanWebView();
            ViewGroup parent = webView != null && webView.getParent() instanceof ViewGroup
                ? (ViewGroup) webView.getParent()
                : activity.findViewById(android.R.id.content);
            if (parent == null) {
                latch.countDown();
                return;
            }
            overlay = buildOverlay();
            parent.addView(overlay, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ));
            texture.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                @Override
                public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
                    ready[0] = true;
                    latch.countDown();
                }

                @Override
                public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {}

                @Override
                public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
                    return true;
                }

                @Override
                public void onSurfaceTextureUpdated(SurfaceTexture surface) {}
            });
            if (texture.isAvailable()) {
                ready[0] = true;
                latch.countDown();
            }
        });
        try {
            if (!latch.await(OPEN_WAIT_MS, TimeUnit.MILLISECONDS)) return false;
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            return false;
        }
        return ready[0];
    }

    private FrameLayout buildOverlay() {
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(Color.parseColor("#020617"));
        texture = new TextureView(activity);
        root.addView(texture, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        texture.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP) {
                float x = event.getX() / Math.max(1f, view.getWidth());
                float y = event.getY() / Math.max(1f, view.getHeight());
                if (frameOverlay != null) frameOverlay.showRing(event.getX(), event.getY());
                refocus(x, y);
            }
            return true;
        });
        frameOverlay = new FrameOverlay(activity);
        frameOverlay.setMode(frameMode);
        frameOverlay.setOnTouchListener((view, event) -> {
            if (texture != null) texture.dispatchTouchEvent(event);
            return true;
        });
        root.addView(frameOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        hint = new TextView(activity);
        hint.setText(hintFor(frameMode));
        hint.setTextColor(Color.parseColor("#E2E8F0"));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(16), dp(56), dp(16), 0);
        root.addView(hint, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        ));

        LinearLayout modes = new LinearLayout(activity);
        modes.setGravity(Gravity.CENTER);
        modes.setOrientation(LinearLayout.HORIZONTAL);
        addMode(modes, "A4 invoice", "a4");
        addMode(modes, "Receipt", "receipt");
        addMode(modes, "Long receipt", "long");
        FrameLayout.LayoutParams modeParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        modeParams.bottomMargin = dp(118);
        root.addView(modes, modeParams);

        LinearLayout bar = new LinearLayout(activity);
        bar.setGravity(Gravity.CENTER);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        TextView cancel = pill("Cancel", false);
        cancel.setOnClickListener(v -> {
            stop();
            eval("window.haulageNativePreview&&window.haulageNativePreview.cancel()");
        });
        View shutter = new View(activity);
        shutter.setBackgroundColor(Color.parseColor("#F59E0B"));
        LinearLayout.LayoutParams shutterParams = new LinearLayout.LayoutParams(dp(68), dp(68));
        shutterParams.leftMargin = dp(18);
        shutterParams.rightMargin = dp(18);
        shutter.setOnClickListener(v -> {
            shutter.setEnabled(false);
            if (hint != null) hint.setText("Focusing…");
            shutter();
        });
        bar.addView(cancel);
        bar.addView(shutter, shutterParams);
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        barParams.bottomMargin = dp(28);
        root.addView(bar, barParams);
        return root;
    }

    private void addMode(LinearLayout row, String label, String mode) {
        TextView button = pill(label, mode.equals(frameMode));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.leftMargin = dp(4);
        params.rightMargin = dp(4);
        button.setOnClickListener(v -> {
            frameMode = mode;
            for (int i = 0; i < row.getChildCount(); i++) {
                View child = row.getChildAt(i);
                if (child instanceof TextView) stylePill((TextView) child, child == v);
            }
            if (frameOverlay != null) frameOverlay.setMode(mode);
            if (hint != null) hint.setText(hintFor(mode));
            refocus(0.5, 0.46);
        });
        row.addView(button, params);
    }

    private TextView pill(String label, boolean on) {
        TextView view = new TextView(activity);
        view.setText(label);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        view.setPadding(dp(16), dp(10), dp(16), dp(10));
        stylePill(view, on);
        return view;
    }

    private void stylePill(TextView view, boolean on) {
        view.setBackgroundColor(on ? Color.parseColor("#F59E0B") : Color.parseColor("#1E293B"));
        view.setTextColor(on ? Color.parseColor("#1A1205") : Color.parseColor("#E6EDF7"));
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private void removeOverlay() {
        if (overlay != null && overlay.getParent() instanceof ViewGroup) {
            ((ViewGroup) overlay.getParent()).removeView(overlay);
        }
        overlay = null;
        texture = null;
        frameOverlay = null;
        hint = null;
    }

    private void closeCamera() {
        if (session != null) {
            try {
                session.close();
            } catch (RuntimeException ignored) {
                // already closed
            }
            session = null;
        }
        if (device != null) {
            try {
                device.close();
            } catch (RuntimeException ignored) {
                // already closed
            }
            device = null;
        }
        if (stillReader != null) {
            stillReader.close();
            stillReader = null;
        }
        previewRequest = null;
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
    }

    private void eval(String script) {
        activity.runOnUiThread(() -> {
            WebView webView = activity.scanWebView();
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private static void fitPreview(TextureView view, Size size) {
        if (view == null || size == null || view.getWidth() == 0 || view.getHeight() == 0) return;
        float viewW = view.getWidth();
        float viewH = view.getHeight();
        float bufW = size.getWidth();
        float bufH = size.getHeight();
        float scale = Math.max(viewW / bufW, viewH / bufH);
        float scaledW = bufW * scale;
        float scaledH = bufH * scale;
        Matrix matrix = new Matrix();
        matrix.setScale(scaledW / viewW, scaledH / viewH, viewW / 2f, viewH / 2f);
        view.setTransform(matrix);
    }

    private void applyAf(CaptureRequest.Builder builder, double focusX, double focusY, boolean trigger) {
        builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
        builder.set(CaptureRequest.CONTROL_AF_MODE, afMode());
        builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
        MeteringRectangle[] regions = afRegions(focusX, focusY);
        if (regions != null) {
            builder.set(CaptureRequest.CONTROL_AF_REGIONS, regions);
            builder.set(CaptureRequest.CONTROL_AE_REGIONS, regions);
        }
        builder.set(
            CaptureRequest.CONTROL_AF_TRIGGER,
            trigger ? CaptureRequest.CONTROL_AF_TRIGGER_START : CaptureRequest.CONTROL_AF_TRIGGER_IDLE
        );
    }

    private int afMode() {
        if (characteristics == null) return CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE;
        int[] modes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
        if (modes == null) return CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE;
        for (int mode : modes) {
            if (mode == CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE) return mode;
        }
        for (int mode : modes) {
            if (mode == CaptureRequest.CONTROL_AF_MODE_MACRO) return mode;
        }
        for (int mode : modes) {
            if (mode == CaptureRequest.CONTROL_AF_MODE_AUTO) return mode;
        }
        return CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE;
    }

    private MeteringRectangle[] afRegions(double focusX, double focusY) {
        if (characteristics == null) return null;
        Integer max = characteristics.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AF);
        Rect active = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        if (max == null || max < 1 || active == null) return null;
        int cx = active.left + (int) Math.round(active.width() * focusX);
        int cy = active.top + (int) Math.round(active.height() * focusY);
        int halfW = Math.max(40, active.width() / 8);
        int halfH = Math.max(40, active.height() / 8);
        int left = clamp(cx - halfW, active.left, active.right - 2);
        int top = clamp(cy - halfH, active.top, active.bottom - 2);
        int right = clamp(cx + halfW, left + 1, active.right);
        int bottom = clamp(cy + halfH, top + 1, active.bottom);
        return new MeteringRectangle[] {
            new MeteringRectangle(new Rect(left, top, right, bottom), MeteringRectangle.METERING_WEIGHT_MAX)
        };
    }

    private CameraDevice openCamera(CameraManager manager, String id) {
        CameraDevice[] box = new CameraDevice[1];
        CountDownLatch latch = new CountDownLatch(1);
        try {
            manager.openCamera(id, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    box[0] = camera;
                    latch.countDown();
                }

                @Override
                public void onDisconnected(CameraDevice camera) {
                    camera.close();
                    latch.countDown();
                }

                @Override
                public void onError(CameraDevice camera, int error) {
                    camera.close();
                    latch.countDown();
                }
            }, handler);
        } catch (CameraAccessException | SecurityException ignored) {
            return null;
        }
        try {
            if (!latch.await(OPEN_WAIT_MS, TimeUnit.MILLISECONDS)) return null;
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            return null;
        }
        return box[0];
    }

    private CameraCaptureSession createSession(CameraDevice camera, java.util.List<Surface> surfaces) {
        CameraCaptureSession[] box = new CameraCaptureSession[1];
        CountDownLatch latch = new CountDownLatch(1);
        try {
            camera.createCaptureSession(surfaces, new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(CameraCaptureSession next) {
                    box[0] = next;
                    latch.countDown();
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession next) {
                    latch.countDown();
                }
            }, handler);
        } catch (CameraAccessException ignored) {
            return null;
        }
        try {
            if (!latch.await(OPEN_WAIT_MS, TimeUnit.MILLISECONDS)) return null;
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            return null;
        }
        return box[0];
    }

    private String backCameraId(CameraManager manager) {
        try {
            String fallback = null;
            for (String id : manager.getCameraIdList()) {
                Integer facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
                if (fallback == null) fallback = id;
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) return id;
            }
            return fallback;
        } catch (CameraAccessException ignored) {
            return null;
        }
    }

    static Size choosePreviewSize(Size[] sizes, int viewW, int viewH) {
        if (sizes == null || sizes.length == 0) return new Size(1280, 720);
        int target = Math.max(1280, Math.min(MAX_PREVIEW_EDGE, Math.max(viewW, viewH)));
        Size best = null;
        long bestGap = Long.MAX_VALUE;
        for (Size size : sizes) {
            int edge = Math.max(size.getWidth(), size.getHeight());
            if (edge < 1280 || edge > MAX_PREVIEW_EDGE) continue;
            long gap = Math.abs(edge - target);
            if (best == null || gap < bestGap) {
                best = size;
                bestGap = gap;
            }
        }
        if (best != null) return best;
        return sizes[0];
    }

    private static String hintFor(String mode) {
        if ("receipt".equals(mode)) {
            return "Line the receipt up inside the amber frame — include the top of the slip and the date. Tap the slip if it looks soft.";
        }
        if ("long".equals(mode)) {
            return "Taller frame for a long docket. Keep the top and the total inside the amber edges. Tap the slip if it looks soft.";
        }
        return "Fit the whole A4 page inside the amber frame, including all four corners. Tap the page if it looks soft.";
    }

    private static double clamp01(double value) {
        if (value < 0 || Double.isNaN(value)) return 0;
        if (value > 1) return 1;
        return value;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static final class FrameOverlay extends View {
        private String mode = "a4";
        private final Paint dim = new Paint();
        private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF frame = new RectF();
        private float ringX = -1;
        private float ringY = -1;

        FrameOverlay(MainActivity activity) {
            super(activity);
            setWillNotDraw(false);
            dim.setColor(Color.parseColor("#94020617"));
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(activity.getResources().getDisplayMetrics().density * 2f);
            stroke.setColor(Color.parseColor("#F59E0B"));
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(activity.getResources().getDisplayMetrics().density * 2f);
            ring.setColor(Color.parseColor("#FBBF24"));
        }

        void setMode(String next) {
            mode = next == null ? "a4" : next;
            invalidate();
        }

        void showRing(float x, float y) {
            ringX = x;
            ringY = y;
            invalidate();
        }

        RectF frameFraction() {
            if (getWidth() < 1 || getHeight() < 1) return new RectF(0.18f, 0.16f, 0.82f, 0.78f);
            layoutFrame(getWidth(), getHeight());
            return new RectF(frame.left / getWidth(), frame.top / getHeight(), frame.right / getWidth(), frame.bottom / getHeight());
        }

        @Override
        protected void onDraw(Canvas canvas) {
            int w = getWidth();
            int h = getHeight();
            layoutFrame(w, h);
            canvas.drawRect(0, 0, w, frame.top, dim);
            canvas.drawRect(0, frame.bottom, w, h, dim);
            canvas.drawRect(0, frame.top, frame.left, frame.bottom, dim);
            canvas.drawRect(frame.right, frame.top, w, frame.bottom, dim);
            canvas.drawRoundRect(frame, 28f, 28f, stroke);
            if (ringX >= 0) canvas.drawCircle(ringX, ringY, 48f, ring);
        }

        private void layoutFrame(int w, int h) {
            float aspect = "receipt".equals(mode) ? 2.2f : "long".equals(mode) ? 3.5f : (297f / 210f);
            float maxW = "receipt".equals(mode) ? w * 0.68f : "long".equals(mode) ? w * 0.54f : w * 0.9f;
            float maxH = h - 280f;
            float width = Math.min(maxW, maxH / aspect);
            float height = width * aspect;
            float left = (w - width) / 2f;
            float top = h * 0.46f - height / 2f;
            frame.set(left, top, left + width, top + height);
        }
    }
}
