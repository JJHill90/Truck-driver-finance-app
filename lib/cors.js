/**
 * Allowlisted CORS for Haulage Finance.
 *
 * Browser / WebView clients that call the API from a different origin (Capacitor
 * Android/iOS shells, a separate marketing domain, etc.) need explicit
 * Access-Control-* headers. Same-origin deploys (Render serving /haulage + API)
 * keep working with no CORS_ORIGINS set — browsers simply omit Origin or match.
 *
 * Env:
 *   CORS_ORIGINS          Comma-separated absolute origins, e.g.
 *                         https://app.example.com,capacitor://localhost
 *   APP_BASE_URL          Also allowlisted (its origin only)
 *   CORS_ALLOW_CAPACITOR  When "1"/"true", also allow common Capacitor/Ionic
 *                         localhost origins used by Play / App Store WebViews
 */

const CAPACITOR_ORIGINS = [
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:3000",
  "https://localhost:3000",
];

function truthyEnv(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function originFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!u.protocol || !u.host) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    // Bare origin without path is fine if URL() accepts it.
    try {
      const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
}

function parseOriginList(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => originFromUrl(s) || (s.includes("://") ? s.replace(/\/$/, "") : null))
    .filter(Boolean);
}

/** Build the effective allowlist from env (plus optional Capacitor defaults). */
function buildAllowlist(env = process.env) {
  const set = new Set(parseOriginList(env.CORS_ORIGINS));
  const fromApp = originFromUrl(env.APP_BASE_URL);
  if (fromApp) set.add(fromApp);
  if (truthyEnv(env.CORS_ALLOW_CAPACITOR)) {
    for (const o of CAPACITOR_ORIGINS) set.add(o);
  }
  return [...set];
}

function isOriginAllowed(origin, allowlist = buildAllowlist()) {
  if (!origin) return false;
  const normalised = String(origin).trim().replace(/\/$/, "");
  return allowlist.includes(normalised);
}

function requestOrigin(req) {
  const raw = req && req.headers ? req.headers.origin : null;
  return raw ? String(raw).trim() : "";
}

function requestHostOrigin(req) {
  if (!req || !req.headers) return null;
  const xfProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const xfHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = xfHost || String(req.headers.host || "").trim();
  if (!host) return null;
  const proto = xfProto || (req.secure ? "https" : "http");
  return `${proto}://${host}`;
}

/** True when browser sent Origin and it differs from this server's public host. */
function isCrossOrigin(req) {
  const origin = requestOrigin(req);
  if (!origin) return false;
  const hostOrigin = requestHostOrigin(req);
  if (!hostOrigin) return Boolean(origin);
  return origin.replace(/\/$/, "") !== hostOrigin.replace(/\/$/, "");
}

/**
 * Cookie flags for session auth.
 * Cross-origin credentialed fetches require SameSite=None; Secure.
 * Same-origin web keeps Lax (and Secure in production).
 */
function sessionCookieFlags(req, env = process.env) {
  const production = String(env.NODE_ENV || "").toLowerCase() === "production";
  const forceSecure = truthyEnv(env.COOKIE_SECURE) || production;
  const cross =
    isCrossOrigin(req) && isOriginAllowed(requestOrigin(req), buildAllowlist(env));

  if (cross) {
    // Secure is mandatory with SameSite=None — browsers reject the cookie otherwise.
    return "HttpOnly; Path=/; SameSite=None; Secure";
  }
  const parts = ["HttpOnly", "Path=/", "SameSite=Lax"];
  if (forceSecure) parts.push("Secure");
  return parts.join("; ");
}

function applyCorsHeaders(req, res, allowlist = buildAllowlist()) {
  const origin = requestOrigin(req);
  if (!origin || !isOriginAllowed(origin, allowlist)) {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  return true;
}

/**
 * Express middleware: allowlisted CORS + short-circuit OPTIONS preflight.
 * Mount near the top of the app (before JSON body parser is fine).
 */
function corsMiddleware(req, res, next) {
  const allowlist = buildAllowlist();
  applyCorsHeaders(req, res, allowlist);

  if ((req.method || "").toUpperCase() === "OPTIONS") {
    // Answer preflight even when Origin is missing/disallowed so probes get 204
    // without hitting auth/route handlers — but only reflect CORS when allowed.
    res.status(204).end();
    return;
  }
  next();
}

module.exports = {
  CAPACITOR_ORIGINS,
  buildAllowlist,
  parseOriginList,
  originFromUrl,
  isOriginAllowed,
  isCrossOrigin,
  requestOrigin,
  requestHostOrigin,
  sessionCookieFlags,
  applyCorsHeaders,
  corsMiddleware,
};
