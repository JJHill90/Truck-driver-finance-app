const fs = require("fs");
const path = require("path");
const {
  TAXHUB_OFFICIAL_ORIGIN,
  TAXHUB_OFFICIAL_WWW_ORIGIN,
  TAXATION_HUB_APP_URL,
  TAXHUB_SHOT_FILES,
  officialPageUrl,
  isTaxationHubOfficialHost,
  isTaxationHubApexHost,
  preferredHubApp,
  wwwToApexRedirect,
  redirectHaulagePaths,
  sitemapXml,
  robotsTxt,
} = require("./lib/taxationhub-public-origin");

function mockRes() {
  return {
    redirected: null,
    redirect(status, url) {
      this.redirected = { status, url };
    },
  };
}

describe("Go Taxation Hub public origin", () => {
  it("is the apex, with www only as a redirect source", () => {
    expect(TAXHUB_OFFICIAL_ORIGIN).toBe("https://gotaxationhub.com");
    expect(TAXHUB_OFFICIAL_WWW_ORIGIN).toBe("https://www.gotaxationhub.com");
    expect(officialPageUrl("/")).toBe("https://gotaxationhub.com/");
    expect(officialPageUrl("/privacy")).toBe("https://gotaxationhub.com/privacy");
    expect(officialPageUrl("terms")).toBe("https://gotaxationhub.com/terms");
    expect(TAXATION_HUB_APP_URL).toBe("https://godriverhub.com/haulage/?app=taxationhub");
    expect(isTaxationHubOfficialHost("gotaxationhub.com")).toBe(true);
    expect(isTaxationHubOfficialHost("WWW.gotaxationhub.com:443")).toBe(true);
    expect(isTaxationHubApexHost("www.gotaxationhub.com")).toBe(false);
    expect(isTaxationHubOfficialHost("godriverhub.com")).toBe(false);
    expect(isTaxationHubOfficialHost("www.godriverhub.com")).toBe(false);
    expect(isTaxationHubOfficialHost("gotaxationsuite.com")).toBe(false);
    expect(isTaxationHubOfficialHost("haulage-finance.onrender.com")).toBe(false);
    expect(isTaxationHubOfficialHost("localhost")).toBe(false);
  });

  it("selects only Taxation Hub from the app query", () => {
    expect(preferredHubApp("")).toBe("");
    expect(preferredHubApp("?app=taxationhub")).toBe("taxationhub");
    expect(preferredHubApp("?app=TAXATIONHUB")).toBe("taxationhub");
    expect(preferredHubApp("?app=financehub")).toBe("taxationhub");
    expect(preferredHubApp("?app=fuelhub")).toBe("");
    expect(preferredHubApp("?app=suite")).toBe("");
    expect(preferredHubApp("https://godriverhub.com/haulage/?app=taxationhub")).toBe("taxationhub");
  });

  it("301s www to the apex once and never sends the apex to www", () => {
    const res = mockRes();
    const next = () => {
      res.nexted = true;
    };
    const www = {
      headers: { "x-forwarded-host": "www.gotaxationhub.com" },
      originalUrl: "/privacy?x=1",
    };
    expect(wwwToApexRedirect(www, res, next)).toBe(true);
    expect(res.redirected).toEqual({
      status: 301,
      url: "https://gotaxationhub.com/privacy?x=1",
    });
    expect(res.redirected.url).not.toMatch(/www\.gotaxationhub\.com/);

    res.redirected = null;
    res.nexted = false;
    const apex = {
      headers: { "x-forwarded-host": "gotaxationhub.com" },
      originalUrl: "/",
    };
    expect(wwwToApexRedirect(apex, res, next)).toBe(false);
    expect(res.redirected).toBeNull();
    expect(res.nexted).toBe(true);

    res.nexted = false;
    const post = { ...www, method: "POST", originalUrl: "/api/haulage/support/contact" };
    expect(wwwToApexRedirect(post, res, next)).toBe(false);
    expect(res.redirected).toBeNull();

    res.nexted = false;
    const driverWww = {
      headers: { host: "www.godriverhub.com" },
      originalUrl: "/",
    };
    expect(wwwToApexRedirect(driverWww, res, next)).toBe(false);
    expect(res.redirected).toBeNull();
  });

  it("sends /haulage on the apex to Taxation Hub and leaves other hosts alone", () => {
    const res = mockRes();
    const next = () => {
      res.nexted = true;
    };
    const home = {
      method: "GET",
      headers: { "x-forwarded-host": "gotaxationhub.com" },
      originalUrl: "/haulage/",
    };
    expect(redirectHaulagePaths(home, res, next)).toBe(true);
    expect(res.redirected).toEqual({ status: 302, url: TAXATION_HUB_APP_URL });

    res.redirected = null;
    res.nexted = false;
    const asset = { ...home, originalUrl: "/haulage/app.js" };
    expect(redirectHaulagePaths(asset, res, next)).toBe(true);
    expect(res.redirected.url).toBe("https://godriverhub.com/haulage/app.js");

    res.redirected = null;
    res.nexted = false;
    const page = { ...home, originalUrl: "/" };
    expect(redirectHaulagePaths(page, res, next)).toBe(false);
    expect(res.redirected).toBeNull();

    res.nexted = false;
    const driver = {
      method: "GET",
      headers: { "x-forwarded-host": "godriverhub.com" },
      originalUrl: "/haulage/",
    };
    expect(redirectHaulagePaths(driver, res, next)).toBe(false);
    expect(res.redirected).toBeNull();
  });

  it("publishes canonical sitemap and robots for the apex only", () => {
    const xml = sitemapXml();
    expect(xml).toMatch(/<loc>https:\/\/gotaxationhub\.com\/<\/loc>/);
    expect(xml).toMatch(/<loc>https:\/\/gotaxationhub\.com\/support<\/loc>/);
    expect(xml).toMatch(/<loc>https:\/\/gotaxationhub\.com\/privacy<\/loc>/);
    expect(xml).toMatch(/<loc>https:\/\/gotaxationhub\.com\/terms<\/loc>/);
    expect(xml).not.toMatch(/www\.gotaxationhub\.com/);
    expect(xml).not.toMatch(/godriverhub\.com/);
    expect(xml).not.toMatch(/fuel/i);

    const robots = robotsTxt();
    expect(robots).toMatch(/Sitemap: https:\/\/gotaxationhub\.com\/sitemap\.xml/);
    expect(robots).toMatch(/Disallow: \/haulage/);
    expect(robots).not.toMatch(/www\.gotaxationhub\.com/);
  });

  it("does not advertise the Fuel Hub login shot", () => {
    expect(TAXHUB_SHOT_FILES).toEqual([
      "02-dashboard.png",
      "03-expenses.png",
      "04-income.png",
      "05-report.png",
    ]);
    expect(TAXHUB_SHOT_FILES.join(" ")).not.toMatch(/01-login/);
    const enhancements = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(enhancements).toMatch(/function preferredHubAppFromUrl/);
    expect(enhancements).toMatch(/app === "taxationhub" \|\| app === "financehub"/);
    expect(enhancements).not.toMatch(/app === "fuelhub"/);
  });
});
