/**
 * Lightweight in-memory rate limiter for auth / support abuse surfaces.
 *
 * Env:
 *   RATE_LIMIT_WINDOW_MS   default 15 minutes
 *   RATE_LIMIT_MAX         default 30 hits per window per key
 *   RATE_LIMIT_LOGIN_MAX   default 20 (stricter bucket for login)
 */
function windowMs() {
  const n = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15 * 60 * 1000;
}

function defaultMax() {
  const n = Number(process.env.RATE_LIMIT_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

function loginMax() {
  const n = Number(process.env.RATE_LIMIT_LOGIN_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xf) return xf;
  return (
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    "unknown"
  );
}

/**
 * @param {{ windowMs?: number, max?: number, keyFn?: Function, message?: string }} opts
 */
function createRateLimiter(opts = {}) {
  const win = opts.windowMs != null ? opts.windowMs : windowMs();
  const max = opts.max != null ? opts.max : defaultMax();
  const keyFn = opts.keyFn || ((req) => clientIp(req));
  const message =
    opts.message || "Too many requests. Please wait a few minutes and try again.";
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function prune(timestamps, now) {
    return timestamps.filter((t) => now - t < win);
  }

  function middleware(req, res, next) {
    const key = String(keyFn(req) || "unknown");
    const now = Date.now();
    const recent = prune(hits.get(key) || [], now);
    if (recent.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((win - (now - recent[0])) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: message, retryAfterSec });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  }

  middleware.resetKey = (key) => {
    hits.delete(String(key));
  };
  middleware.resetAll = () => {
    hits.clear();
  };
  middleware._hits = hits;
  middleware.windowMs = win;
  middleware.max = max;

  return middleware;
}

/** Path → limiter map for auth/support write routes. */
function createAuthSupportRateLimiters() {
  const ipLimiter = createRateLimiter({
    max: defaultMax(),
    message: "Too many requests from this network. Please wait and try again.",
  });
  const loginLimiter = createRateLimiter({
    max: loginMax(),
    keyFn: (req) => {
      const user = String((req.body && req.body.username) || "")
        .trim()
        .toLowerCase();
      return `${clientIp(req)}|login|${user || "-"}`;
    },
    message: "Too many sign-in attempts. Please wait a few minutes, or use account recovery.",
  });

  const pathMap = {
    "/auth/login": loginLimiter,
    "/auth/register": ipLimiter,
    "/auth/recover/request": ipLimiter,
    "/auth/recover/reset": ipLimiter,
    "/auth/password-strength": ipLimiter,
    "/support/contact": ipLimiter,
  };

  function middleware(req, res, next) {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "POST") {
      next();
      return;
    }
    const limiter = pathMap[req.path];
    if (!limiter) {
      next();
      return;
    }
    return limiter(req, res, next);
  }

  middleware.resetAll = () => {
    ipLimiter.resetAll();
    loginLimiter.resetAll();
  };

  return middleware;
}

module.exports = {
  clientIp,
  createRateLimiter,
  createAuthSupportRateLimiters,
  windowMs,
  defaultMax,
  loginMax,
};
