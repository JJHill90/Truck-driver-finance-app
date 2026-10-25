package com.haulagefinance.app;

import android.net.Uri;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keep the Play package on the Driver Hub <strong>app</strong>
 * ({@code https://godriverhub.com/haulage/}), not the public website and
 * not an unknown host (those show {@code ERR_NAME_NOT_RESOLVED} in Chrome).
 * www stays an official host so one www ↔ apex redirect stays in this WebView.
 *
 * Returning {@code null} lets Capacitor open Chrome or show
 * {@code ERR_NAME_NOT_RESOLVED}. Returning {@code false} keeps the load in
 * this WebView. Returning {@code true} means we handled it (bounce to the app).
 */
@CapacitorPlugin(name = "HubNavigation")
public class HubNavigationPlugin extends Plugin {
    static final String HOSTED_HOST = "www.godriverhub.com";
    static final String HOSTED_APEX = "godriverhub.com";

    static boolean isOfficialHost(String host) {
        if (host == null) {
            return false;
        }
        return HOSTED_HOST.equalsIgnoreCase(host) || HOSTED_APEX.equalsIgnoreCase(host);
    }

    static boolean isLocalHost(String host) {
        if (host == null) {
            return false;
        }
        String h = host.toLowerCase();
        return "localhost".equals(h)
            || "127.0.0.1".equals(h)
            || "10.0.2.2".equals(h)
            || h.endsWith(".localhost")
            || "capacitor".equals(h)
            || h.startsWith("capacitor");
    }

    static boolean isAppPath(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) {
            return false;
        }
        return path.equals("/haulage")
            || path.startsWith("/haulage/")
            || path.startsWith("/api/haulage");
    }

    static String bounceToApp(String path) {
        if ("/privacy".equals(path) || "/privacy.html".equals(path)) {
            return "https://godriverhub.com/haulage/privacy";
        }
        if ("/terms".equals(path) || "/terms.html".equals(path)) {
            return "https://godriverhub.com/haulage/terms";
        }
        if ("/support".equals(path) || "/support.html".equals(path)) {
            return "https://godriverhub.com/haulage/support";
        }
        return MainActivity.HUB_URL;
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null || url.getHost() == null) {
            return null;
        }
        String host = url.getHost();
        if (isLocalHost(host)) {
            return null;
        }
        String path = url.getPath() == null ? "/" : url.getPath();
        if (isOfficialHost(host) && isAppPath(path)) {
            return false;
        }
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            String bounce = bounceToApp(isOfficialHost(host) ? path : "/");
            webView.post(() -> webView.loadUrl(bounce));
        }
        return true;
    }
}
