/**
 * Product switch for Go Taxation Suite vs Driver Hub / Taxation Hub.
 * Suite pages set cookie `gotax_product=1` and live under `/suite/`.
 * app.js still calls `/api/haulage`, so the API dispatches on this flag.
 *
 * A dedicated Render service sets `APP_PRODUCT=suite` (alias `GOTAX_STANDALONE=1`)
 * so every request uses Go Taxation Suite and `/` redirects to `/suite/`.
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

/** Dedicated Go Taxation Suite host (second Render service). */
function isStandaloneSuite(env = process.env) {
  const product = String((env && env.APP_PRODUCT) || "")
    .trim()
    .toLowerCase();
  if (product === "haulage" || product === "driverhub" || product === "taxationhub") {
    return false;
  }
  if (product === "suite" || product === "gotax") return true;
  return truthyEnv(env && env.GOTAX_STANDALONE);
}

function isSuiteRequest(req) {
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

/** Strip trailing slashes from a public origin (https://….onrender.com). */
function normalizePublicOrigin(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

/**
 * Absolute URL of the sibling Render service.
 * Driver Hub host → SUITE_PUBLIC_URL; Suite host → DRIVERHUB_PUBLIC_URL.
 * Empty when unset (local single-process demo still serves both paths).
 */
function siblingPublicUrl(env = process.env) {
  if (isStandaloneSuite(env)) {
    return normalizePublicOrigin(env.DRIVERHUB_PUBLIC_URL || env.HAULAGE_PUBLIC_URL);
  }
  return normalizePublicOrigin(env.SUITE_PUBLIC_URL || env.GOTAX_PUBLIC_URL);
}

function suiteEntryUrl(env = process.env) {
  const origin = normalizePublicOrigin(env.SUITE_PUBLIC_URL || env.GOTAX_PUBLIC_URL);
  return origin ? `${origin}/suite/` : "/suite/";
}

function driverHubEntryUrl(env = process.env) {
  const origin = normalizePublicOrigin(env.DRIVERHUB_PUBLIC_URL || env.HAULAGE_PUBLIC_URL);
  return origin ? `${origin}/haulage/` : "/haulage/";
}

/**
 * Product identity for the UI /version payload so each Render host can label
 * itself and deep-link to the other service (never the same-host /suite path
 * once SUITE_PUBLIC_URL is set).
 */
function productMeta(req, env = process.env) {
  const standalone = isStandaloneSuite(env);
  const product = productOf(req);
  const isSuite = product === "suite" || standalone;
  return {
    product: isSuite ? "suite" : "haulage",
    standalone,
    productName: isSuite ? "Go Taxation Suite" : "Driver Hub",
    siblingProductName: isSuite ? "Driver Hub" : "Go Taxation Suite",
    siblingUrl: siblingPublicUrl(env),
    homePath: isSuite ? "/suite/" : "/haulage/",
    suiteEntryUrl: suiteEntryUrl(env),
    driverHubEntryUrl: driverHubEntryUrl(env),
    separateDeployments: Boolean(siblingPublicUrl(env) || standalone),
  };
}

module.exports = {
  PRODUCT_COOKIE,
  isStandaloneSuite,
  isSuiteRequest,
  productOf,
  publicHomePath,
  recoveryPagePath,
  cacheKey,
  parseCacheKey,
  normalizePublicOrigin,
  siblingPublicUrl,
  suiteEntryUrl,
  driverHubEntryUrl,
  productMeta,
};
