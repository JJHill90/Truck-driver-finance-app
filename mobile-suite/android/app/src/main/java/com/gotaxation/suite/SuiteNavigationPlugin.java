package com.gotaxation.suite;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keep Suite's hosted origin inside the WebView. Without this, Capacitor
 * treats an off-localhost host as an external intent and either opens Chrome
 * or (when listed in allowNavigation) proxies HTML through HttpURLConnection,
 * which fails against Cloudflare / a sleeping Render instance and leaves a
 * navy splash on screen.
 */
@CapacitorPlugin(name = "SuiteNavigation")
public class SuiteNavigationPlugin extends Plugin {
    static final String HOSTED_HOST = "go-taxation-suite.onrender.com";

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null || url.getHost() == null) {
            return null;
        }
        if (HOSTED_HOST.equalsIgnoreCase(url.getHost())) {
            return false;
        }
        return null;
    }
}
