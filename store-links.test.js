const { cleanHttpsUrl, linksForProduct } = require("./lib/store-links");

describe("store listing URLs", () => {
  it("accepts https store URLs and strips a trailing slash", () => {
    expect(cleanHttpsUrl("https://play.google.com/store/apps/details?id=com.gotaxation.suite/")).toBe(
      "https://play.google.com/store/apps/details?id=com.gotaxation.suite"
    );
    expect(cleanHttpsUrl("https://apps.apple.com/app/id123")).toBe("https://apps.apple.com/app/id123");
  });

  it("rejects empty, relative, and non-https values", () => {
    expect(cleanHttpsUrl("")).toBe("");
    expect(cleanHttpsUrl("  ")).toBe("");
    expect(cleanHttpsUrl("/suite/")).toBe("");
    expect(cleanHttpsUrl("http://evil.example/store")).toBe("");
    expect(cleanHttpsUrl("javascript:alert(1)")).toBe("");
  });

  it("returns empty store URLs and the Suite app path until env is set", () => {
    const links = linksForProduct("suite", {});
    expect(links).toEqual({
      product: "suite",
      appUrl: "/suite/",
      playStoreUrl: "",
      appStoreUrl: "",
    });
  });

  it("reads Suite Play / App Store env vars when they are https", () => {
    const links = linksForProduct("suite", {
      SUITE_PLAY_STORE_URL: "https://play.google.com/store/apps/details?id=com.gotaxation.suite",
      SUITE_APP_STORE_URL: "https://apps.apple.com/app/go-taxation-suite/id000",
    });
    expect(links.playStoreUrl).toMatch(/^https:\/\/play\.google\.com\//);
    expect(links.appStoreUrl).toMatch(/^https:\/\/apps\.apple\.com\//);
    expect(links.appUrl).toBe("/suite/");
  });

  it("keeps Driver Hub store URLs separate from Suite", () => {
    const links = linksForProduct("haulage", {
      SUITE_PLAY_STORE_URL: "https://play.google.com/store/apps/details?id=com.gotaxation.suite",
      DRIVERHUB_PLAY_STORE_URL: "https://play.google.com/store/apps/details?id=com.haulagefinance.app",
      DRIVERHUB_APP_STORE_URL: "https://apps.apple.com/app/driver-hub/id000",
    });
    expect(links.product).toBe("haulage");
    expect(links.appUrl).toBe("/haulage/");
    expect(links.playStoreUrl).toContain("com.haulagefinance.app");
    expect(links.appStoreUrl).toContain("apps.apple.com");
  });
});
