package com.haulagefinance.app;

import android.net.Uri;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keep the Play package on the Driver Hub <strong>app</strong> ({@code /haulage/}),
 * not the public marketing website at {@code godriverhub.com/}.
 *
 * Without this, Capacitor treats an off-localhost host as an external intent
 * and opens Chrome, or (when listed in allowNavigation) proxies HTML through
 * HttpURLConnection. A www → apex 301 looks like a new website load and
 * Chrome takes over.
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
        if (!isOfficialHost(url.getHost())) {
            return null;
        }
        String path = url.getPath() == null ? "/" : url.getPath();
        if (isAppPath(path)) {
            return false;
        }
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            String bounce = bounceToApp(path);
            webView.post(() -> webView.loadUrl(bounce));
        }
        return true;
    }
}
