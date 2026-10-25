/**
 * Public marketing host for Go Taxation Hub (gotaxationhub.com).
 *
 * The pages are the Driver Hub overview layout with Fuel Hub removed. They
 * are served by the existing haulage-finance Express app when the Host is
 * this domain. They are not a third Render service and not Go Taxation Suite.
 *
 * Canonical host is the apex. www 301s to the apex once, in the same
 * direction as Render's edge when the apex is the custom domain that was
 * added. Do not add the opposite redirect (apex → www): that is the
 * godriverhub.com loop (Render edge one way, this app the other).
 *
 * Open-app links leave this host. Taxation Hub is the signed-in shell at
 * https://godriverhub.com/haulage/?app=taxationhub — there is no separate
 * Taxation Hub origin.
 */

const { DRIVERHUB_OFFICIAL_ORIGIN } = require("./driverhub-public-origin");

const TAXHUB_OFFICIAL_HOST = "gotaxationhub.com";
const TAXHUB_OFFICIAL_WWW_HOST = "www.gotaxationhub.com";
const TAXHUB_OFFICIAL_HOSTS = [TAXHUB_OFFICIAL_HOST, TAXHUB_OFFICIAL_WWW_HOST];
const TAXHUB_OFFICIAL_ORIGIN = `https://${TAXHUB_OFFICIAL_HOST}`;
const TAXHUB_OFFICIAL_WWW_ORIGIN = `https://${TAXHUB_OFFICIAL_WWW_HOST}`;
const TAXHUB_OFFICIAL_ORIGINS = [TAXHUB_OFFICIAL_ORIGIN, TAXHUB_OFFICIAL_WWW_ORIGIN];

/** Signed-in Taxation Hub inside Driver Hub. Apex, not www. */
const TAXATION_HUB_APP_URL = `${DRIVERHUB_OFFICIAL_ORIGIN}/haulage/?app=taxationhub`;

/**
 * Real Taxation Hub phone screenshots under mobile/store.
 * 01-login.png is the Driver Hub picker and shows the Fuel Hub tile, so it
 * is not on this site.
 */
const TAXHUB_SHOT_FILES = [
  "02-dashboard.png",
  "03-expenses.png",
  "04-income.png",
  "05-report.png",
];

const SITEMAP_PATHS = ["/", "/support", "/privacy", "/terms"];

function officialPageUrl(pathname = "/") {
  const raw = String(pathname || "/");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  if (path === "/") return `${TAXHUB_OFFICIAL_ORIGIN}/`;
  return `${TAXHUB_OFFICIAL_ORIGIN}${path}`;
}

function hostFromRequest(req) {
  if (!req || !req.headers) return "";
  const xfHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = xfHost || String(req.headers.host || "").trim();
  return host.replace(/:\d+$/, "").toLowerCase();
}

function normalizeHost(host) {
  return String(host || "")
    .replace(/:\d+$/, "")
    .trim()
    .toLowerCase();
}

function isTaxationHubOfficialHost(host) {
  return TAXHUB_OFFICIAL_HOSTS.includes(normalizeHost(host));
}

function isTaxationHubApexHost(host) {
  return normalizeHost(host) === TAXHUB_OFFICIAL_HOST;
}

/**
 * Marketing deep link. `financehub` is the pre-rename localStorage value.
 * Any other app= value is ignored so this cannot select Fuel Hub.
 */
function preferredHubApp(search) {
  const raw = String(search || "");
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw.replace(/^\?/, "");
  let app = "";
  try {
    app = String(new URLSearchParams(query).get("app") || "")
      .trim()
      .toLowerCase();
  } catch {
    app = "";
  }
  if (app === "taxationhub" || app === "financehub") return "taxationhub";
  return "";
}

function requestTarget(req) {
  const rest = String((req && (req.originalUrl || req.url)) || "/");
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/**
 * www → apex for every GET/HEAD, including /haulage. This host has no Play
 * WebView that must stay on www. Apex requests are never redirected.
 */
function wwwToApexRedirect(req, res, next) {
  if (hostFromRequest(req) !== TAXHUB_OFFICIAL_WWW_HOST) {
    if (typeof next === "function") next();
    return false;
  }
  const method = String((req && req.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    if (typeof next === "function") next();
    return false;
  }
  const path = requestTarget(req);
  if (path.startsWith("https://") || path.startsWith("//")) {
    if (typeof next === "function") next();
    return false;
  }
  res.redirect(301, `${TAXHUB_OFFICIAL_ORIGIN}${path}`);
  return true;
}

function isHaulagePath(pathname) {
  const path = String(pathname || "/").split("?")[0];
  return path === "/haulage" || path.startsWith("/haulage/");
}

/**
 * The marketing host does not serve the Driver Hub SPA. /haulage and
 * /haulage/ go to Taxation Hub. Other /haulage/* paths (privacy inside the
 * app, static files) follow the same path on the Driver Hub apex.
 */
function redirectHaulagePaths(req, res, next) {
  if (!isTaxationHubApexHost(hostFromRequest(req))) {
    if (typeof next === "function") next();
    return false;
  }
  const method = String((req && req.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    if (typeof next === "function") next();
    return false;
  }
  const target = requestTarget(req);
  const pathOnly = target.split("?")[0];
  if (!isHaulagePath(pathOnly)) {
    if (typeof next === "function") next();
    return false;
  }
  if (pathOnly === "/haulage" || pathOnly === "/haulage/") {
    res.redirect(302, TAXATION_HUB_APP_URL);
    return true;
  }
  res.redirect(302, `${DRIVERHUB_OFFICIAL_ORIGIN}${target}`);
  return true;
}

function sitemapXml() {
  const body = SITEMAP_PATHS.map((pathname) => `  <url><loc>${officialPageUrl(pathname)}</loc></url>`).join(
    "\n"
  );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${body}\n` +
    `</urlset>\n`
  );
}

function robotsTxt() {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /haulage",
    `Sitemap: ${officialPageUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}

module.exports = {
  TAXHUB_OFFICIAL_HOST,
  TAXHUB_OFFICIAL_WWW_HOST,
  TAXHUB_OFFICIAL_HOSTS,
  TAXHUB_OFFICIAL_ORIGIN,
  TAXHUB_OFFICIAL_WWW_ORIGIN,
  TAXHUB_OFFICIAL_ORIGINS,
  TAXATION_HUB_APP_URL,
  TAXHUB_SHOT_FILES,
  SITEMAP_PATHS,
  officialPageUrl,
  hostFromRequest,
  isTaxationHubOfficialHost,
  isTaxationHubApexHost,
  preferredHubApp,
  wwwToApexRedirect,
  redirectHaulagePaths,
  sitemapXml,
  robotsTxt,
};
