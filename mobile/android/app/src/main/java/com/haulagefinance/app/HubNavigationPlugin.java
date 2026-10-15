package com.haulagefinance.app;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keep Driver Hub's hosted origin inside the WebView. Without this, Capacitor
 * treats an off-localhost host as an external intent and either opens Chrome
 * or (when listed in allowNavigation) proxies HTML through HttpURLConnection,
 * which fails against Cloudflare and leaves a navy splash on screen.
 */
@CapacitorPlugin(name = "HubNavigation")
public class HubNavigationPlugin extends Plugin {
    static final String HOSTED_HOST = "www.godriverhub.com";
    static final String HOSTED_APEX = "godriverhub.com";

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null || url.getHost() == null) {
            return null;
        }
        String host = url.getHost();
        if (HOSTED_HOST.equalsIgnoreCase(host) || HOSTED_APEX.equalsIgnoreCase(host)) {
            return false;
        }
        return null;
    }
}
