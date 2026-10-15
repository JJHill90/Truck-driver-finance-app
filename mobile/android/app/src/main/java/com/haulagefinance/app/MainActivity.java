package com.haulagefinance.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String HUB_URL = "https://www.godriverhub.com/haulage/";

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
        webView.post(() -> webView.loadUrl(HUB_URL));
    }

    private void openHostedHubIfStillLocal() {
        WebView webView = webView();
        if (webView == null) {
            return;
        }
        String url = String.valueOf(webView.getUrl());
        boolean hosted = url.contains(HubNavigationPlugin.HOSTED_HOST)
            || url.contains(HubNavigationPlugin.HOSTED_APEX);
        if (!hosted) {
            webView.post(() -> webView.loadUrl(HUB_URL));
        }
    }

    private WebView webView() {
        if (getBridge() == null) {
            return null;
        }
        return getBridge().getWebView();
    }
}
