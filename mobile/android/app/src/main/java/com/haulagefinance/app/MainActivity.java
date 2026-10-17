package com.haulagefinance.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Play package loads the app, never the marketing homepage at /. */
    static final String HUB_URL = "https://godriverhub.com/haulage/";
    static final String NATIVE_UA = "DriverHubApp";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        final boolean[] keepSplash = {true};
        splash.setKeepOnScreenCondition(() -> keepSplash[0]);
        registerPlugin(HubNavigationPlugin.class);
        super.onCreate(savedInstanceState);

        Handler handler = new Handler(Looper.getMainLooper());
        handler.postDelayed(() -> keepSplash[0] = false, 700);
        handler.postDelayed(this::openHostedHub, 350);
        handler.postDelayed(this::openHostedHubIfStillLocal, 4000);
    }

    private void openHostedHub() {
        WebView webView = webView();
        if (webView == null) {
            new Handler(Looper.getMainLooper()).postDelayed(this::openHostedHub, 250);
            return;
        }
        webView.post(() -> {
            markNativeUserAgent(webView);
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
                markNativeUserAgent(webView);
                webView.loadUrl(HUB_URL);
            });
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

    private WebView webView() {
        if (getBridge() == null) {
            return null;
        }
        return getBridge().getWebView();
    }
}
