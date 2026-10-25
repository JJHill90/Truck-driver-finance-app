/**
 * Official public host for Driver Hub.
 *
 * The marketing site, Privacy, Terms, Support, and /haulage/ already live on
 * the Express app (Render service `haulage-finance`). Attach these hosts as
 * Render custom domains — do not stand up a second website, and do not point
 * this domain at Go Taxation Suite (`go-taxation-suite`).
 *
 * Use HTTPS. HTTP cookies, Stripe Checkout, and Play / App Store listings
 * need a trusted certificate (Render issues one after DNS verifies).
 */

const { isStandaloneSuite } = require("./suite/product");

const DRIVERHUB_OFFICIAL_HOST = "godriverhub.com";
const DRIVERHUB_OFFICIAL_WWW_HOST = "www.godriverhub.com";
const DRIVERHUB_OFFICIAL_HOSTS = [DRIVERHUB_OFFICIAL_HOST, DRIVERHUB_OFFICIAL_WWW_HOST];
const DRIVERHUB_OFFICIAL_ORIGIN = `https://${DRIVERHUB_OFFICIAL_HOST}`;
const DRIVERHUB_OFFICIAL_WWW_ORIGIN = `https://${DRIVERHUB_OFFICIAL_WWW_HOST}`;
const DRIVERHUB_OFFICIAL_ORIGINS = [DRIVERHUB_OFFICIAL_ORIGIN, DRIVERHUB_OFFICIAL_WWW_ORIGIN];

function officialPageUrl(pathname = "/") {
  const raw = String(pathname || "/");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${DRIVERHUB_OFFICIAL_ORIGIN}${path}`;
}

function hostFromRequest(req) {
  if (!req || !req.headers) return "";
  const xfHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = xfHost || String(req.headers.host || "").trim();
  return host.replace(/:\d+$/, "").toLowerCase();
}

function isDriverHubOfficialHost(host) {
  const h = String(host || "")
    .replace(/:\d+$/, "")
    .trim()
    .toLowerCase();
  return DRIVERHUB_OFFICIAL_HOSTS.includes(h);
}

function requestPath(req) {
  const rest = String((req && (req.originalUrl || req.url)) || "/");
  const withSlash = rest.startsWith("/") ? rest : `/${rest}`;
  return withSlash.split("?")[0];
}

function isHubAppPath(pathname) {
  const path = String(pathname || "/");
  return path === "/haulage" || path.startsWith("/haulage/") || path.startsWith("/api/haulage");
}

function isDriverHubNativeApp(req) {
  const ua = String((req && req.headers && (req.headers["user-agent"] || req.headers["User-Agent"])) || "");
  return /\bDriverHubApp\b/i.test(ua);
}

/**
 * Play / iOS WebView must stay on /haulage/ (the app). Do not serve the
 * public marketing homepage at / inside the native package.
 */
function nativeAppToHaulageRedirect(req, res, next) {
  if (!isDriverHubNativeApp(req)) {
    if (typeof next === "function") next();
    return false;
  }
  const method = String((req && req.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    if (typeof next === "function") next();
    return false;
  }
  const path = requestPath(req);
  if (isHubAppPath(path)) {
    if (typeof next === "function") next();
    return false;
  }
  let dest = "/haulage/";
  if (path === "/privacy" || path === "/privacy.html") dest = "/haulage/privacy";
  else if (path === "/terms" || path === "/terms.html") dest = "/haulage/terms";
  else if (path === "/support" || path === "/support.html") dest = "/haulage/support";
  else if (
    path === "/" ||
    path === "/welcome" ||
    path === "/welcome.html" ||
    path === "/welcome-driverhub" ||
    path === "/welcome-driverhub.html"
  ) {
    dest = "/haulage/";
  } else {
    if (typeof next === "function") next();
    return false;
  }
  res.redirect(302, dest);
  return true;
}

/**
 * On the Driver Hub host, send www → apex so browsers / Stripe / cookies share
 * one origin. Do not bounce /haulage or /api/haulage: that 301 is a host change
 * and Capacitor opens Chrome (the marketing site) instead of the Play app.
 * Leave other hosts (localhost, onrender) and the Suite service alone.
 *
 * Do not add the opposite redirect (apex → www). Render's custom-domain edge
 * already 301s the apex to www when `www.godriverhub.com` is the domain that
 * was added in the dashboard. That edge redirect never reaches Express (no
 * `x-powered-by` / `rndr-id`). Combined with this middleware it is a loop.
 * The apex must be the domain added on haulage-finance so Render's edge
 * 301s www → apex once. This middleware then only runs if a www request
 * still reaches Node, and it must keep the same direction.
 */
function wwwToApexRedirect(req, res, next) {
  if (isStandaloneSuite()) {
    if (typeof next === "function") next();
    return false;
  }
  if (hostFromRequest(req) !== DRIVERHUB_OFFICIAL_WWW_HOST) {
    if (typeof next === "function") next();
    return false;
  }
  const method = String((req && req.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    if (typeof next === "function") next();
    return false;
  }
  const rest = String(req.originalUrl || "/");
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  if (isHubAppPath(path.split("?")[0])) {
    if (typeof next === "function") next();
    return false;
  }
  res.redirect(301, `${DRIVERHUB_OFFICIAL_ORIGIN}${path}`);
  return true;
}

module.exports = {
  DRIVERHUB_OFFICIAL_HOST,
  DRIVERHUB_OFFICIAL_WWW_HOST,
  DRIVERHUB_OFFICIAL_HOSTS,
  DRIVERHUB_OFFICIAL_ORIGIN,
  DRIVERHUB_OFFICIAL_WWW_ORIGIN,
  DRIVERHUB_OFFICIAL_ORIGINS,
  officialPageUrl,
  hostFromRequest,
  isDriverHubOfficialHost,
  isHubAppPath,
  isDriverHubNativeApp,
  nativeAppToHaulageRedirect,
  wwwToApexRedirect,
};
