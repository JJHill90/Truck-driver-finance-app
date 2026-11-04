package com.haulagefinance.app;

import android.Manifest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * Play package loads the hosted app (login + Taxation Hub / Fuel Hub)
     * on the apex. www.godriverhub.com only redirects there. Do not open
     * the marketing homepage at /. Do not set Capacitor server.url.
     */
    static final String HUB_URL = "https://godriverhub.com/haulage/";
    static final String NATIVE_UA = "DriverHubApp";
    private boolean liveCacheCleared;
    private ActivityResultLauncher<String> cameraPermissionLauncher;
    private PermissionRequest pendingCameraRequest;
    private ScanCameraFocus scanCameraFocus;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        final boolean[] keepSplash = {true};
        splash.setKeepOnScreenCondition(() -> keepSplash[0]);
        registerPlugin(HubNavigationPlugin.class);
        super.onCreate(savedInstanceState);
        cameraPermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            this::onCameraPermissionResult
        );
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (scanCameraFocus != null && scanCameraFocus.stopLivePreviewFromBack()) {
                    WebView page = scanWebView();
                    if (page != null) {
                        page.evaluateJavascript(
                            "window.haulageNativePreview&&window.haulageNativePreview.cancel()",
                            null
                        );
                    }
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });

        Handler handler = new Handler(Looper.getMainLooper());
        handler.postDelayed(() -> keepSplash[0] = false, 700);
        handler.postDelayed(this::openHostedHub, 350);
        handler.postDelayed(this::openHostedHubIfStillLocal, 4000);
    }

    private void onCameraPermissionResult(Boolean granted) {
        PermissionRequest request = pendingCameraRequest;
        pendingCameraRequest = null;
        if (request == null) return;
        try {
            if (Boolean.TRUE.equals(granted)) {
                request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            } else {
                request.deny();
            }
        } catch (RuntimeException ignored) {
            // The page already dropped this capture request.
        }
    }

    private void openHostedHub() {
        WebView webView = webView();
        if (webView == null) {
            new Handler(Looper.getMainLooper()).postDelayed(this::openHostedHub, 250);
            return;
        }
        webView.post(() -> {
            installCameraPermissionBridge(webView);
            installScanCameraBridge(webView);
            markNativeUserAgent(webView);
            useLiveServer(webView);
            webView.loadUrl(HUB_URL);
        });
    }

    private void openHostedHubIfStillLocal() {
        WebView webView = webView();
        if (webView == null) {
            return;
        }
        String url = String.valueOf(webView.getUrl());
        boolean inApp = HubNavigationPlugin.isOfficialHost(hostOf(url))
            && url.contains("/haulage");
        if (!inApp) {
            webView.post(() -> {
                installCameraPermissionBridge(webView);
                installScanCameraBridge(webView);
                markNativeUserAgent(webView);
                useLiveServer(webView);
                webView.loadUrl(HUB_URL);
            });
        } else {
            webView.post(() -> {
                installCameraPermissionBridge(webView);
                installScanCameraBridge(webView);
            });
        }
    }

    @Override
    public void onDestroy() {
        if (scanCameraFocus != null) {
            scanCameraFocus.shutdown();
            scanCameraFocus = null;
        }
        super.onDestroy();
    }

    /**
     * getUserMedia in this WebView asks the page permission only after the
     * app grants RESOURCE_VIDEO_CAPTURE. Grant immediately when CAMERA is
     * already allowed so the page is not told the user denied it. Otherwise
     * ask once, then grant or deny that same request.
     */
    private void installCameraPermissionBridge(WebView webView) {
        if (webView == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        WebChromeClient existing = webView.getWebChromeClient();
        if (existing instanceof CameraPermissionChromeClient) return;
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.setWebChromeClient(new CameraPermissionChromeClient(existing));
    }

    /**
     * WebView getUserMedia often ignores focusMode. The page calls
     * HubScanCamera.captureFocusedJpeg after it releases the preview track.
     * This does not grant or deny RESOURCE_VIDEO_CAPTURE.
     */
    private void installScanCameraBridge(WebView webView) {
        if (webView == null) return;
        if (scanCameraFocus == null) {
            scanCameraFocus = new ScanCameraFocus(this);
            scanCameraFocus.attachPreview(new ScanCameraPreview(this));
        }
        webView.addJavascriptInterface(scanCameraFocus, "HubScanCamera");
    }

    /** Drop a cached shell so receipt extraction matches the live Render app. */
    private void useLiveServer(WebView webView) {
        webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (!liveCacheCleared) {
            webView.clearCache(true);
            liveCacheCleared = true;
        }
    }

    private void markNativeUserAgent(WebView webView) {
        String ua = webView.getSettings().getUserAgentString();
        if (ua == null) {
            ua = "";
        }
        if (!ua.contains(NATIVE_UA)) {
            webView.getSettings().setUserAgentString(ua + " " + NATIVE_UA);
        }
    }

    private static String hostOf(String url) {
        try {
            return android.net.Uri.parse(url).getHost();
        } catch (Exception ignored) {
            return "";
        }
    }

    WebView scanWebView() {
        return webView();
    }

    private WebView webView() {
        if (getBridge() == null) {
            return null;
        }
        return getBridge().getWebView();
    }

    private void grantWebCamera(PermissionRequest request) {
        request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
    }

    private final class CameraPermissionChromeClient extends WebChromeClient {
        private final WebChromeClient delegate;

        CameraPermissionChromeClient(WebChromeClient delegate) {
            this.delegate = delegate;
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            if (request == null) return;
            String[] resources = request.getResources();
            boolean wantsCamera = false;
            boolean wantsOther = false;
            if (resources != null) {
                for (String resource : resources) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsCamera = true;
                    else wantsOther = true;
                }
            }
            if (!wantsCamera || wantsOther) {
                if (delegate != null) delegate.onPermissionRequest(request);
                else super.onPermissionRequest(request);
                return;
            }
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                grantWebCamera(request);
                return;
            }
            if (pendingCameraRequest != null && pendingCameraRequest != request) {
                try {
                    pendingCameraRequest.deny();
                } catch (RuntimeException ignored) {
                    // The earlier request already finished.
                }
            }
            pendingCameraRequest = request;
            if (cameraPermissionLauncher == null) {
                pendingCameraRequest = null;
                request.deny();
                return;
            }
            try {
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA);
            } catch (IllegalStateException ignored) {
                // A camera prompt is already showing. Keep this request so the
                // result callback can grant it instead of reporting a denial.
            }
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (request != null && request == pendingCameraRequest) pendingCameraRequest = null;
        }

        @Override
        public boolean onShowFileChooser(
            WebView webView,
            ValueCallback<Uri[]> filePathCallback,
            FileChooserParams fileChooserParams
        ) {
            if (delegate != null) return delegate.onShowFileChooser(webView, filePathCallback, fileChooserParams);
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (delegate != null) delegate.onGeolocationPermissionsShowPrompt(origin, callback);
            else super.onGeolocationPermissionsShowPrompt(origin, callback);
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (delegate != null) return delegate.onJsAlert(view, url, message, result);
            return super.onJsAlert(view, url, message, result);
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            if (delegate != null) return delegate.onJsConfirm(view, url, message, result);
            return super.onJsConfirm(view, url, message, result);
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            if (delegate != null) return delegate.onJsPrompt(view, url, message, defaultValue, result);
            return super.onJsPrompt(view, url, message, defaultValue, result);
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
            if (delegate != null) return delegate.onConsoleMessage(consoleMessage);
            return super.onConsoleMessage(consoleMessage);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (delegate != null) delegate.onShowCustomView(view, callback);
            else super.onShowCustomView(view, callback);
        }

        @Override
        public void onHideCustomView() {
            if (delegate != null) delegate.onHideCustomView();
            else super.onHideCustomView();
        }
    }
}
