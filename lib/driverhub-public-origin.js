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

/**
 * On the Driver Hub host, send www → apex so Play / Stripe / cookies share
 * one origin. Leave other hosts (localhost, onrender) and the Suite service
 * alone.
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
  wwwToApexRedirect,
};
