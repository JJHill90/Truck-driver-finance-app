package com.haulagefinance.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureResult;
import android.hardware.camera2.TotalCaptureResult;
import android.hardware.camera2.params.MeteringRectangle;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Size;
import android.view.Surface;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Close-focus still for Scan with camera when Android WebView ignores
 * focusMode / pointsOfInterest. The page releases its getUserMedia track
 * first, then this opens the back camera, runs continuous-picture autofocus
 * with an AF trigger on the amber-frame centre, and returns a JPEG.
 *
 * <p>Does not grant or deny the WebView capture permission. That stays in
 * {@link MainActivity}'s existing CAMERA / RESOURCE_VIDEO_CAPTURE flow.
 */
public class ScanCameraFocus {
    private static final int MAX_EDGE = 4032;
    private static final long MAX_PIXELS = 12_000_000L;
    private static final long OPEN_WAIT_MS = 900;
    private static final long FOCUS_WAIT_MS = 700;
    private static final long STILL_WAIT_MS = 1200;
    private static final long MIN_FOCUS_MOVE_MS = 350;

    private final Context context;
    private final HandlerThread thread;
    private final Handler handler;

    ScanCameraFocus(Context context) {
        this.context = context.getApplicationContext();
        thread = new HandlerThread("scan-camera-focus");
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    void shutdown() {
        thread.quitSafely();
    }

    /**
     * @param focusX normalised 0–1 in the preview buffer (amber frame centre)
     * @param focusY normalised 0–1 in the preview buffer
     * @return base64 JPEG, or "" when Camera2 cannot take the still
     */
    @JavascriptInterface
    public String captureFocusedJpeg(double focusX, double focusY, int videoWidth, int videoHeight) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            return "";
        }
        try {
            byte[] jpeg = captureStill(clamp01(focusX), clamp01(focusY), videoWidth, videoHeight);
            if (jpeg == null || jpeg.length == 0) return "";
            return Base64.encodeToString(jpeg, Base64.NO_WRAP);
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    @Nullable
    private byte[] captureStill(double focusX, double focusY, int videoWidth, int videoHeight) {
        CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        if (manager == null) return null;
        String id;
        try {
            id = backCameraId(manager);
        } catch (CameraAccessException ignored) {
            return null;
        }
        if (id == null) return null;

        CameraCharacteristics chars;
        try {
            chars = manager.getCameraCharacteristics(id);
        } catch (CameraAccessException ignored) {
            return null;
        }
        StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null) return null;
        Size[] jpegSizes = map.getOutputSizes(ImageFormat.JPEG);
        Size size = chooseJpegSize(jpegSizes, videoWidth, videoHeight);
        if (size == null) return null;

        int orientation = jpegOrientation(chars);
        int afMode = afMode(chars);
        MeteringRectangle[] regions = afRegions(chars, focusX, focusY);

        ImageReader reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.JPEG, 1);
        SurfaceTexture texture = new SurfaceTexture(0);
        texture.setDefaultBufferSize(640, 480);
        Surface preview = new Surface(texture);
        CameraDevice device = null;
        CameraCaptureSession session = null;
        try {
            device = openBackCamera(manager, id);
            if (device == null) return null;
            session = openSession(device, Arrays.asList(preview, reader.getSurface()));
            if (session == null) return null;
            runFocus(device, session, preview, afMode, regions);
            byte[] jpeg = takeStill(device, session, reader, orientation, afMode, regions);
            if (jpeg == null) return null;
            return fitPreviewAspect(jpeg, orientation, videoWidth, videoHeight);
        } catch (CameraAccessException | InterruptedException ignored) {
            return null;
        } finally {
            if (session != null) {
                try {
                    session.close();
                } catch (RuntimeException ignored) {
                    // already closed
                }
            }
            if (device != null) {
                try {
                    device.close();
                } catch (RuntimeException ignored) {
                    // already closed
                }
            }
            preview.release();
            texture.release();
            reader.close();
        }
    }

    @Nullable
    private CameraDevice openBackCamera(CameraManager manager, String id) throws InterruptedException {
        for (int attempt = 0; attempt < 2; attempt++) {
            CameraDevice opened = tryOpen(manager, id);
            if (opened != null) return opened;
            Thread.sleep(150);
        }
        return null;
    }

    @Nullable
    private CameraDevice tryOpen(CameraManager manager, String id) throws InterruptedException {
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
        if (!latch.await(OPEN_WAIT_MS, TimeUnit.MILLISECONDS)) return null;
        return box[0];
    }

    @Nullable
    private CameraCaptureSession openSession(CameraDevice device, java.util.List<Surface> surfaces)
            throws InterruptedException {
        CameraCaptureSession[] box = new CameraCaptureSession[1];
        CountDownLatch latch = new CountDownLatch(1);
        try {
            device.createCaptureSession(surfaces, new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(CameraCaptureSession session) {
                    box[0] = session;
                    latch.countDown();
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession session) {
                    latch.countDown();
                }
            }, handler);
        } catch (CameraAccessException ignored) {
            return null;
        }
        if (!latch.await(OPEN_WAIT_MS, TimeUnit.MILLISECONDS)) return null;
        return box[0];
    }

    private void runFocus(
        CameraDevice device,
        CameraCaptureSession session,
        Surface preview,
        int afMode,
        @Nullable MeteringRectangle[] regions
    ) throws CameraAccessException, InterruptedException {
        CaptureRequest.Builder repeating = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
        repeating.addTarget(preview);
        applyAf(repeating, afMode, regions);
        CountDownLatch focused = new CountDownLatch(1);
        long started = SystemClock.uptimeMillis();
        session.setRepeatingRequest(repeating.build(), new CameraCaptureSession.CaptureCallback() {
            @Override
            public void onCaptureCompleted(
                CameraCaptureSession s,
                CaptureRequest request,
                TotalCaptureResult result
            ) {
                Integer state = result.get(CaptureResult.CONTROL_AF_STATE);
                boolean locked = state != null
                    && (state == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED
                        || state == CaptureResult.CONTROL_AF_STATE_NOT_FOCUSED_LOCKED);
                if (locked && SystemClock.uptimeMillis() - started >= MIN_FOCUS_MOVE_MS) {
                    focused.countDown();
                }
            }
        }, handler);

        CaptureRequest.Builder trigger = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
        trigger.addTarget(preview);
        applyAf(trigger, afMode, regions);
        trigger.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_START);
        session.capture(trigger.build(), null, handler);
        focused.await(FOCUS_WAIT_MS, TimeUnit.MILLISECONDS);
    }

    @Nullable
    private byte[] takeStill(
        CameraDevice device,
        CameraCaptureSession session,
        ImageReader reader,
        int orientation,
        int afMode,
        @Nullable MeteringRectangle[] regions
    ) throws CameraAccessException, InterruptedException {
        byte[][] box = new byte[1][];
        CountDownLatch latch = new CountDownLatch(1);
        reader.setOnImageAvailableListener(imageReader -> {
            Image image = null;
            try {
                image = imageReader.acquireNextImage();
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

        CaptureRequest.Builder still = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
        still.addTarget(reader.getSurface());
        applyAf(still, afMode, regions);
        still.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_IDLE);
        still.set(CaptureRequest.JPEG_ORIENTATION, orientation);
        still.set(CaptureRequest.JPEG_QUALITY, (byte) 92);
        session.capture(still.build(), null, handler);
        if (!latch.await(STILL_WAIT_MS, TimeUnit.MILLISECONDS)) return null;
        return box[0];
    }

    private static void applyAf(CaptureRequest.Builder builder, int afMode, @Nullable MeteringRectangle[] regions) {
        builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
        builder.set(CaptureRequest.CONTROL_AF_MODE, afMode);
        builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
        builder.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO);
        if (regions != null) {
            builder.set(CaptureRequest.CONTROL_AF_REGIONS, regions);
            builder.set(CaptureRequest.CONTROL_AE_REGIONS, regions);
        }
    }

    @Nullable
    private static String backCameraId(CameraManager manager) throws CameraAccessException {
        String fallback = null;
        for (String id : manager.getCameraIdList()) {
            Integer facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
            if (fallback == null) fallback = id;
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) return id;
        }
        return fallback;
    }

    private static int afMode(CameraCharacteristics chars) {
        int[] modes = chars.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
        if (modes == null) return CaptureRequest.CONTROL_AF_MODE_OFF;
        if (contains(modes, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
            return CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE;
        }
        if (contains(modes, CaptureRequest.CONTROL_AF_MODE_MACRO)) {
            return CaptureRequest.CONTROL_AF_MODE_MACRO;
        }
        if (contains(modes, CaptureRequest.CONTROL_AF_MODE_AUTO)) {
            return CaptureRequest.CONTROL_AF_MODE_AUTO;
        }
        return CaptureRequest.CONTROL_AF_MODE_OFF;
    }

    @Nullable
    private static MeteringRectangle[] afRegions(CameraCharacteristics chars, double focusX, double focusY) {
        Integer max = chars.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AF);
        if (max == null || max < 1) return null;
        Rect active = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        if (active == null || active.width() < 2 || active.height() < 2) return null;
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

    @SuppressWarnings("deprecation")
    private int jpegOrientation(CameraCharacteristics chars) {
        Integer sensor = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
        int sensorDegrees = sensor == null ? 90 : sensor;
        int device = 0;
        try {
            WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (wm != null && wm.getDefaultDisplay() != null) {
                device = rotationDegrees(wm.getDefaultDisplay().getRotation());
            }
        } catch (RuntimeException ignored) {
            device = 0;
        }
        Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
        if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
            return (360 - ((sensorDegrees + device) % 360)) % 360;
        }
        return (sensorDegrees - device + 360) % 360;
    }

    private static int rotationDegrees(int rotation) {
        switch (rotation) {
            case android.view.Surface.ROTATION_90:
                return 90;
            case android.view.Surface.ROTATION_180:
                return 180;
            case android.view.Surface.ROTATION_270:
                return 270;
            default:
                return 0;
        }
    }

    @Nullable
    static Size chooseJpegSize(@Nullable Size[] sizes, int videoWidth, int videoHeight) {
        if (sizes == null || sizes.length == 0) return null;
        double target = videoWidth > 0 && videoHeight > 0
            ? (double) videoWidth / (double) videoHeight
            : 9.0 / 16.0;
        Size best = null;
        double bestDiff = Double.MAX_VALUE;
        long bestPixels = -1;
        for (Size size : sizes) {
            long pixels = (long) size.getWidth() * (long) size.getHeight();
            int edge = Math.max(size.getWidth(), size.getHeight());
            if (pixels < 640L * 480L || pixels > MAX_PIXELS || edge > MAX_EDGE) continue;
            double aspect = (double) size.getWidth() / (double) size.getHeight();
            double flipped = (double) size.getHeight() / (double) size.getWidth();
            double diff = Math.min(Math.abs(aspect - target), Math.abs(flipped - target));
            if (best == null || diff < bestDiff - 0.02 || (Math.abs(diff - bestDiff) <= 0.02 && pixels > bestPixels)) {
                best = size;
                bestDiff = diff;
                bestPixels = pixels;
            }
        }
        return best != null ? best : sizes[0];
    }

    private static byte[] fitPreviewAspect(byte[] jpeg, int orientation, int videoWidth, int videoHeight) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, bounds);
            if (bounds.outWidth < 1 || bounds.outHeight < 1) return jpeg;
            int sample = 1;
            while (bounds.outWidth / sample > MAX_EDGE || bounds.outHeight / sample > MAX_EDGE) {
                sample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, opts);
            if (decoded == null) return jpeg;
            Bitmap upright = rotate(decoded, orientation);
            if (upright != decoded) decoded.recycle();
            Bitmap fitted = centerCropToAspect(upright, videoWidth, videoHeight);
            if (fitted != upright) upright.recycle();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            fitted.compress(Bitmap.CompressFormat.JPEG, 92, out);
            fitted.recycle();
            return out.toByteArray();
        } catch (OutOfMemoryError ignored) {
            return jpeg;
        }
    }

    private static Bitmap rotate(Bitmap bitmap, int orientation) {
        int degrees = ((orientation % 360) + 360) % 360;
        if (degrees == 0) return bitmap;
        Matrix matrix = new Matrix();
        matrix.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
    }

    private static Bitmap centerCropToAspect(Bitmap bitmap, int videoWidth, int videoHeight) {
        if (videoWidth < 1 || videoHeight < 1) return bitmap;
        double target = (double) videoWidth / (double) videoHeight;
        double current = (double) bitmap.getWidth() / (double) bitmap.getHeight();
        if (target <= 0 || Math.abs(current - target) / target < 0.02) return bitmap;
        int cropW;
        int cropH;
        if (current > target) {
            cropH = bitmap.getHeight();
            cropW = Math.max(1, (int) Math.round(cropH * target));
        } else {
            cropW = bitmap.getWidth();
            cropH = Math.max(1, (int) Math.round(cropW / target));
        }
        int x = Math.max(0, (bitmap.getWidth() - cropW) / 2);
        int y = Math.max(0, (bitmap.getHeight() - cropH) / 2);
        cropW = Math.min(cropW, bitmap.getWidth() - x);
        cropH = Math.min(cropH, bitmap.getHeight() - y);
        if (cropW < 1 || cropH < 1) return bitmap;
        return Bitmap.createBitmap(bitmap, x, y, cropW, cropH);
    }

    private static boolean contains(int[] values, int wanted) {
        if (values == null) return false;
        for (int value : values) {
            if (value == wanted) return true;
        }
        return false;
    }

    private static double clamp01(double value) {
        if (value < 0 || Double.isNaN(value)) return 0;
        if (value > 1) return 1;
        return value;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
