/**
 * Product switch for Go Taxation Suite vs Driver Hub / Taxation Hub.
 * Suite pages set cookie `gotax_product=1` and live under `/suite/`.
 * app.js still calls `/api/haulage`, so the API dispatches on this flag.
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

function isSuiteRequest(req) {
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
  isSuiteRequest,
  productOf,
  cacheKey,
  parseCacheKey,
};
