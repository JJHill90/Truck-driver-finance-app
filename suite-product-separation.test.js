const {
  isStandaloneSuite,
  productOf,
  siblingPublicUrl,
  suiteEntryUrl,
  driverHubEntryUrl,
  productMeta,
} = require("./lib/suite/product");

describe("Render product separation", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete process.env[key];
    }
    Object.assign(process.env, prev);
  });

  it("exposes sibling URLs for each host", () => {
    process.env.APP_PRODUCT = "haulage";
    process.env.SUITE_PUBLIC_URL = "https://suite.example.com/"; // pragma: allowlist secret
    delete process.env.DRIVERHUB_PUBLIC_URL;
    expect(isStandaloneSuite()).toBe(false);
    expect(siblingPublicUrl()).toBe("https://suite.example.com");
    expect(suiteEntryUrl()).toBe("https://suite.example.com/suite/");
    expect(productMeta({ headers: {} }).separateDeployments).toBe(true);
    expect(productMeta({ headers: {} }).suiteEntryUrl).toContain("suite.example.com");
  });

  it("points Suite hosts back at Driver Hub", () => {
    process.env.APP_PRODUCT = "suite";
    process.env.DRIVERHUB_PUBLIC_URL = "https://driverhub.example.com"; // pragma: allowlist secret
    delete process.env.SUITE_PUBLIC_URL;
    expect(isStandaloneSuite()).toBe(true);
    expect(productOf({ headers: {} })).toBe("suite");
    expect(siblingPublicUrl()).toBe("https://driverhub.example.com");
    expect(driverHubEntryUrl()).toBe("https://driverhub.example.com/haulage/");
    const meta = productMeta({ headers: {} });
    expect(meta.standalone).toBe(true);
    expect(meta.productName).toBe("Go Taxation Suite");
    expect(meta.siblingProductName).toBe("Driver Hub");
  });

  it("keeps local same-host paths when sibling URLs are unset", () => {
    process.env.APP_PRODUCT = "haulage";
    delete process.env.SUITE_PUBLIC_URL;
    delete process.env.GOTAX_PUBLIC_URL;
    delete process.env.DRIVERHUB_PUBLIC_URL;
    expect(suiteEntryUrl()).toBe("/suite/");
    expect(driverHubEntryUrl()).toBe("/haulage/");
    expect(productMeta({ headers: {} }).separateDeployments).toBe(false);
  });
});
