package com.gotaxation.suite;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String SUITE_URL = "https://go-taxation-suite.onrender.com/suite/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        final boolean[] keepSplash = {true};
        splash.setKeepOnScreenCondition(() -> keepSplash[0]);
        registerPlugin(SuiteNavigationPlugin.class);
        super.onCreate(savedInstanceState);

        Handler handler = new Handler(Looper.getMainLooper());
        handler.postDelayed(() -> keepSplash[0] = false, 700);
        handler.postDelayed(this::openHostedSuite, 350);
        handler.postDelayed(this::openHostedSuiteIfStillLocal, 4000);
    }

    private void openHostedSuite() {
        WebView webView = webView();
        if (webView == null) {
            new Handler(Looper.getMainLooper()).postDelayed(this::openHostedSuite, 250);
            return;
        }
        webView.post(() -> webView.loadUrl(SUITE_URL));
    }

    private void openHostedSuiteIfStillLocal() {
        WebView webView = webView();
        if (webView == null) {
            return;
        }
        String url = String.valueOf(webView.getUrl());
        boolean hosted = url.contains(SuiteNavigationPlugin.HOSTED_HOST);
        if (!hosted) {
            webView.post(() -> webView.loadUrl(SUITE_URL));
        }
    }

    private WebView webView() {
        if (getBridge() == null) {
            return null;
        }
        return getBridge().getWebView();
    }
}
