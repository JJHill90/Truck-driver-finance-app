/**
 * Product switch for Go Taxation Suite vs Driver Hub / Taxation Hub.
 *
 * Dedicated Render hosts lock the product with APP_PRODUCT:
 *   haulage | driverhub | taxationhub  → Driver Hub only (ignore suite cookie)
 *   suite   | gotax                    → Go Taxation Suite only
 *
 * Local combined hosts (APP_PRODUCT unset) still allow /suite/ via cookie
 * `gotax_product=1` or a /suite referer. Production Driver Hub must never
 * honour that switch, so truck-driver records and ATO tables stay isolated.
 */

const PRODUCT_COOKIE = "gotax_product";

function cookieMap(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx > -1) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
      }
    });
  return out;
}

function truthyEnv(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envProduct(env = process.env) {
  return String((env && env.APP_PRODUCT) || "")
    .trim()
    .toLowerCase();
}

/** Dedicated Driver Hub / Taxation Hub host (haulage-finance Render service). */
function isStandaloneHaulage(env = process.env) {
  const product = envProduct(env);
  return product === "haulage" || product === "driverhub" || product === "taxationhub";
}

/** Dedicated Go Taxation Suite host (go-taxation-suite Render service). */
function isStandaloneSuite(env = process.env) {
  if (isStandaloneHaulage(env)) return false;
  const product = envProduct(env);
  if (product === "suite" || product === "gotax") return true;
  return truthyEnv(env && env.GOTAX_STANDALONE);
}

function isSuiteRequest(req) {
  if (isStandaloneHaulage()) return false;
  if (isStandaloneSuite()) return true;
  if (!req) return false;
  const cookies = cookieMap(req.headers && req.headers.cookie);
  if (cookies[PRODUCT_COOKIE] === "1") return true;
  const ref = String((req.headers && (req.headers.referer || req.headers.referrer)) || "");
  if (/\/suite(\/|$|\?|#)/i.test(ref)) return true;
  const q = req.query && (req.query.product || req.query.app);
  if (String(q || "").toLowerCase() === "suite" || String(q || "").toLowerCase() === "gotax") {
    return true;
  }
  return false;
}

function productOf(req) {
  return isSuiteRequest(req) ? "suite" : "haulage";
}

function publicHomePath(req) {
  return productOf(req) === "suite" || isStandaloneSuite() ? "/suite/" : "/haulage/";
}

function recoveryPagePath(req) {
  const prefix = productOf(req) === "suite" ? "/suite" : "/haulage";
  return `${prefix}/recover.html`;
}

/**
 * Path to send the browser to when this host is locked to the other product.
 * Returns null when the request is allowed on this host.
 */
function lockedProductRedirectPath(reqPath, env = process.env) {
  const p = String(reqPath || "").split("?")[0];
  if (isStandaloneHaulage(env) && /^\/suite(\/|$)/i.test(p)) return "/haulage/";
  if (isStandaloneSuite(env) && /^\/haulage(\/|$)/i.test(p)) {
    const rest = p.replace(/^\/haulage/i, "") || "/";
    return `/suite${rest}`;
  }
  return null;
}

function cacheKey(username, product) {
  if (!username) return product === "suite" ? "__suite_guest__" : "__guest__";
  return product === "suite" ? `suite:${username}` : username;
}

function parseCacheKey(key) {
  const k = String(key || "");
  if (k === "__suite_guest__") return { user: null, product: "suite" };
  if (k === "__guest__") return { user: null, product: "haulage" };
  if (k.startsWith("suite:")) return { user: k.slice(6), product: "suite" };
  return { user: k, product: "haulage" };
}

module.exports = {
  PRODUCT_COOKIE,
  isStandaloneHaulage,
  isStandaloneSuite,
  isSuiteRequest,
  productOf,
  publicHomePath,
  recoveryPagePath,
  lockedProductRedirectPath,
  cacheKey,
  parseCacheKey,
};
