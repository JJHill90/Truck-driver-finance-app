const fs = require("fs");
const path = require("path");

const privacy = fs.readFileSync(path.join(__dirname, "public/privacy.html"), "utf8");
const terms = fs.readFileSync(path.join(__dirname, "public/terms.html"), "utf8");
const support = fs.readFileSync(path.join(__dirname, "public/support.html"), "utf8");
const hubPrivacy = fs.readFileSync(path.join(__dirname, "public/privacy-driverhub.html"), "utf8");

describe("public legal pages", () => {
  it("Suite privacy is Go Taxation Suite only — no Driver Hub or driver apps", () => {
    expect(privacy).toMatch(/Privacy Policy/i);
    expect(privacy).toMatch(/Go Taxation Suite/);
    expect(privacy).toMatch(/photograph or upload receipts/i);
    expect(privacy).toMatch(/Delete account/i);
    expect(privacy).toMatch(/do not use receipt photos for advertising/i);
    expect(privacy).toMatch(/does not lodge a BAS or tax return/i);
    expect(privacy).not.toMatch(/Driver Hub/i);
    expect(privacy).not.toMatch(/Taxation Hub/i);
    expect(privacy).not.toMatch(/Fuel Hub/i);
    expect(privacy).not.toMatch(/truck-driver/i);
    expect(privacy).not.toMatch(/work vehicle/i);
  });

  it("Suite terms keep honest tax wording and Suite-only Stripe prices", () => {
    expect(terms).toMatch(/Go Taxation Suite/);
    expect(terms).toMatch(/not an official ATO product/i);
    expect(terms).toMatch(/does not lodge a BAS or income-tax return/i);
    expect(terms).toMatch(/auto-renew/i);
    expect(terms).toMatch(/Stripe Customer Portal/i);
    expect(terms).toMatch(/Restore purchases/i);
    expect(terms).toMatch(/\$10 \/ month or \$110 \/ year/);
    expect(terms).toMatch(/\$18 \/ month or \$190 \/ year/);
    expect(terms).not.toMatch(/Driver Hub/i);
    expect(terms).not.toMatch(/Taxation Hub/i);
    expect(terms).not.toMatch(/Fuel Hub/i);
    expect(terms).not.toMatch(/\$5 \/ month or \$60 \/ year/);
  });

  it("Suite support page is store-safe and Suite-only", () => {
    expect(support).toMatch(/Support — Go Taxation Suite|Support<\/h1>/);
    expect(support).toMatch(/support@godriverhub.com/);
    expect(support).toMatch(/Delete account/i);
    expect(support).not.toMatch(/Driver Hub/i);
    expect(support).not.toMatch(/Taxation Hub/i);
    expect(support).not.toMatch(/Fuel Hub/i);
  });

  it("Driver Hub keeps a separate privacy page for the website footer", () => {
    expect(hubPrivacy).toMatch(/Driver Hub/);
    expect(hubPrivacy).toMatch(/does not lodge a BAS or tax return/i);
  });
});
