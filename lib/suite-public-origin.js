/**
 * Official public host for Go Taxation Suite.
 *
 * The marketing site, Privacy, Terms, Support, and /suite/ already live on
 * the Express app (Render service `go-taxation-suite`). Attach these hosts
 * as Render custom domains — do not stand up a second website, and do not
 * point this domain at Driver Hub (`haulage-finance`).
 *
 * Use HTTPS. HTTP cookies, Stripe Checkout, and Play / App Store listings
 * need a trusted certificate (Render issues one after DNS verifies).
 */

const SUITE_OFFICIAL_HOST = "gotaxationsuite.com";
const SUITE_OFFICIAL_WWW_HOST = "www.gotaxationsuite.com";
const SUITE_OFFICIAL_HOSTS = [SUITE_OFFICIAL_HOST, SUITE_OFFICIAL_WWW_HOST];
const SUITE_OFFICIAL_ORIGIN = `https://${SUITE_OFFICIAL_HOST}`;
const SUITE_OFFICIAL_WWW_ORIGIN = `https://${SUITE_OFFICIAL_WWW_HOST}`;
const SUITE_OFFICIAL_ORIGINS = [SUITE_OFFICIAL_ORIGIN, SUITE_OFFICIAL_WWW_ORIGIN];

function officialPageUrl(pathname = "/") {
  const raw = String(pathname || "/");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${SUITE_OFFICIAL_ORIGIN}${path}`;
}

function hostFromRequest(req) {
  if (!req || !req.headers) return "";
  const xfHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = xfHost || String(req.headers.host || "").trim();
  return host.replace(/:\d+$/, "").toLowerCase();
}

function isSuiteOfficialHost(host) {
  const h = String(host || "")
    .replace(/:\d+$/, "")
    .trim()
    .toLowerCase();
  return SUITE_OFFICIAL_HOSTS.includes(h);
}

/**
 * On the dedicated Suite host, send www → apex so Play / Stripe / cookies
 * share one origin. Leave other hosts (localhost, onrender) alone.
 */
function wwwToApexRedirect(req, res, next) {
  const { isStandaloneSuite } = require("./suite/product");
  if (!isStandaloneSuite()) {
    if (typeof next === "function") next();
    return false;
  }
  if (hostFromRequest(req) !== SUITE_OFFICIAL_WWW_HOST) {
    if (typeof next === "function") next();
    return false;
  }
  const method = String((req && req.method) || "GET").toUpperCase();
  // Keep POST (login, Stripe webhook) on www if a client still calls it.
  if (method !== "GET" && method !== "HEAD") {
    if (typeof next === "function") next();
    return false;
  }
  const rest = String(req.originalUrl || "/");
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  res.redirect(301, `${SUITE_OFFICIAL_ORIGIN}${path}`);
  return true;
}

module.exports = {
  SUITE_OFFICIAL_HOST,
  SUITE_OFFICIAL_WWW_HOST,
  SUITE_OFFICIAL_HOSTS,
  SUITE_OFFICIAL_ORIGIN,
  SUITE_OFFICIAL_WWW_ORIGIN,
  SUITE_OFFICIAL_ORIGINS,
  officialPageUrl,
  hostFromRequest,
  isSuiteOfficialHost,
  wwwToApexRedirect,
};
