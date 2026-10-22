const {
  DRIVERHUB_OFFICIAL_ORIGIN,
  DRIVERHUB_OFFICIAL_WWW_ORIGIN,
  DRIVERHUB_OFFICIAL_ORIGINS,
  officialPageUrl,
  hostFromRequest,
  isDriverHubOfficialHost,
  wwwToApexRedirect,
} = require("./lib/driverhub-public-origin");

describe("Driver Hub official public origin", () => {
  const prevProduct = process.env.APP_PRODUCT;

  afterEach(() => {
    if (prevProduct === undefined) delete process.env.APP_PRODUCT;
    else process.env.APP_PRODUCT = prevProduct;
  });

  it("is HTTPS apex + www, never a second site", () => {
    expect(DRIVERHUB_OFFICIAL_ORIGIN).toBe("https://godriverhub.com");
    expect(DRIVERHUB_OFFICIAL_WWW_ORIGIN).toBe("https://www.godriverhub.com");
    expect(DRIVERHUB_OFFICIAL_ORIGINS).toEqual([
      "https://godriverhub.com",
      "https://www.godriverhub.com",
    ]);
    expect(officialPageUrl("/privacy")).toBe("https://godriverhub.com/privacy");
    expect(officialPageUrl("terms")).toBe("https://godriverhub.com/terms");
    expect(isDriverHubOfficialHost("godriverhub.com")).toBe(true);
    expect(isDriverHubOfficialHost("WWW.godriverhub.com:443")).toBe(true);
    expect(isDriverHubOfficialHost("haulage-finance.onrender.com")).toBe(false);
    expect(isDriverHubOfficialHost("gotaxationsuite.com")).toBe(false);
  });

  it("reads the public host from X-Forwarded-Host", () => {
    expect(
      hostFromRequest({
        headers: {
          host: "haulage-finance.onrender.com",
          "x-forwarded-host": "www.godriverhub.com, localhost",
        },
      })
    ).toBe("www.godriverhub.com");
  });

  it("redirects www → apex on the Driver Hub host, not on Suite", () => {
    delete process.env.APP_PRODUCT;
    const res = {
      redirected: null,
      redirect(status, url) {
        this.redirected = { status, url };
      },
    };
    const req = {
      headers: { host: "www.godriverhub.com", "x-forwarded-proto": "https" },
      originalUrl: "/privacy",
    };
    expect(wwwToApexRedirect(req, res, () => {})).toBe(true);
    expect(res.redirected).toEqual({
      status: 301,
      url: "https://godriverhub.com/privacy",
    });

    process.env.APP_PRODUCT = "suite";
    res.redirected = null;
    expect(wwwToApexRedirect(req, res, () => {})).toBe(false);
    expect(res.redirected).toBeNull();

    delete process.env.APP_PRODUCT;
    const postReq = { ...req, method: "POST", originalUrl: "/api/haulage/billing/webhook" };
    expect(wwwToApexRedirect(postReq, res, () => {})).toBe(false);
  });

  it("leaves onrender and localhost alone", () => {
    delete process.env.APP_PRODUCT;
    let nextCalled = false;
    const res = {
      redirect() {
        throw new Error("should not redirect");
      },
    };
    expect(
      wwwToApexRedirect(
        { headers: { host: "haulage-finance.onrender.com" }, originalUrl: "/" },
        res,
        () => {
          nextCalled = true;
        }
      )
    ).toBe(false);
    expect(nextCalled).toBe(true);
  });
});
