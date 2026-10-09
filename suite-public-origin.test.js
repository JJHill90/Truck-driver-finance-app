const {
  SUITE_OFFICIAL_ORIGIN,
  SUITE_OFFICIAL_WWW_ORIGIN,
  SUITE_OFFICIAL_ORIGINS,
  officialPageUrl,
  hostFromRequest,
  isSuiteOfficialHost,
  wwwToApexRedirect,
} = require("./lib/suite-public-origin");

describe("Suite official public origin", () => {
  const prevProduct = process.env.APP_PRODUCT;

  afterEach(() => {
    if (prevProduct === undefined) delete process.env.APP_PRODUCT;
    else process.env.APP_PRODUCT = prevProduct;
  });

  it("is HTTPS apex + www, never a second site", () => {
    expect(SUITE_OFFICIAL_ORIGIN).toBe("https://gotaxationsuite.com");
    expect(SUITE_OFFICIAL_WWW_ORIGIN).toBe("https://www.gotaxationsuite.com");
    expect(SUITE_OFFICIAL_ORIGINS).toEqual([
      "https://gotaxationsuite.com",
      "https://www.gotaxationsuite.com",
    ]);
    expect(officialPageUrl("/privacy")).toBe("https://gotaxationsuite.com/privacy");
    expect(officialPageUrl("terms")).toBe("https://gotaxationsuite.com/terms");
    expect(isSuiteOfficialHost("gotaxationsuite.com")).toBe(true);
    expect(isSuiteOfficialHost("WWW.gotaxationsuite.com:443")).toBe(true);
    expect(isSuiteOfficialHost("go-taxation-suite.onrender.com")).toBe(false);
  });

  it("reads the public host from X-Forwarded-Host", () => {
    expect(
      hostFromRequest({
        headers: {
          host: "go-taxation-suite.onrender.com",
          "x-forwarded-host": "www.gotaxationsuite.com, localhost",
        },
      })
    ).toBe("www.gotaxationsuite.com");
  });

  it("redirects www → apex only on the standalone Suite host", () => {
    process.env.APP_PRODUCT = "suite";
    const res = {
      redirected: null,
      redirect(status, url) {
        this.redirected = { status, url };
      },
    };
    const req = {
      headers: { host: "www.gotaxationsuite.com", "x-forwarded-proto": "https" },
      originalUrl: "/privacy",
    };
    expect(wwwToApexRedirect(req, res, () => {})).toBe(true);
    expect(res.redirected).toEqual({
      status: 301,
      url: "https://gotaxationsuite.com/privacy",
    });

    delete process.env.APP_PRODUCT;
    res.redirected = null;
    expect(wwwToApexRedirect(req, res, () => {})).toBe(false);
    expect(res.redirected).toBeNull();

    process.env.APP_PRODUCT = "suite";
    const postReq = { ...req, method: "POST", originalUrl: "/api/haulage/billing/webhook" };
    expect(wwwToApexRedirect(postReq, res, () => {})).toBe(false);
    expect(res.redirected).toBeNull();
  });

  it("leaves onrender and localhost alone", () => {
    process.env.APP_PRODUCT = "suite";
    let nextCalled = false;
    const res = { redirect() { throw new Error("should not redirect"); } };
    expect(
      wwwToApexRedirect(
        { headers: { host: "go-taxation-suite.onrender.com" }, originalUrl: "/" },
        res,
        () => {
          nextCalled = true;
        }
      )
    ).toBe(false);
    expect(nextCalled).toBe(true);
  });
});
