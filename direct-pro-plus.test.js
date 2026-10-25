const fs = require("fs");
const path = require("path");

const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
const hubHtml = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const enhancements = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");

describe("direct Pro+ checkout", () => {
  it("shows Start Pro+ on Suite Plan without waiting for a Pro subscription", () => {
    expect(suiteHtml).toMatch(/id="billing-upgrade-plus"/);
    expect(suiteHtml).toMatch(/Start Pro\+/);
    expect(suiteHtml).not.toMatch(/id="billing-upgrade-plus"[^>]*\bhidden\b/);
    expect(hubHtml).not.toMatch(/id="billing-upgrade-plus"/);
  });

  it("lets the upgrade modal start Pro+ in one checkout", () => {
    expect(enhancements).toMatch(/Go straight to Pro\+/);
    expect(enhancements).toMatch(/you do not need Pro first/i);
    expect(enhancements).toMatch(/data-billing-plan="pro_plus"/);
    expect(enhancements).toMatch(/Start Pro\+/);
  });
});
