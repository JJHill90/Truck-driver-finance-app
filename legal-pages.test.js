const fs = require("fs");
const path = require("path");

const privacy = fs.readFileSync(path.join(__dirname, "public/privacy.html"), "utf8");
const terms = fs.readFileSync(path.join(__dirname, "public/terms.html"), "utf8");

describe("public legal pages", () => {
  it("privacy states camera use, account deletion and no advertising of photos", () => {
    expect(privacy).toMatch(/Privacy Policy/i);
    expect(privacy).toMatch(/photograph or upload receipts/i);
    expect(privacy).toMatch(/Delete account/i);
    expect(privacy).toMatch(/not used for advertising/i);
    expect(privacy).toMatch(/do not lodge a BAS or tax return/i);
  });

  it("terms keep honest tax wording and website Stripe subscription copy", () => {
    expect(terms).toMatch(/not an official ATO product/i);
    expect(terms).toMatch(/do not lodge a BAS or income-tax return/i);
    expect(terms).toMatch(/auto-renew/i);
    expect(terms).toMatch(/Stripe Customer Portal/i);
    expect(terms).toMatch(/Restore purchases/i);
    expect(terms).toMatch(/\$5 \/ month or \$60 \/ year/);
    expect(terms).toMatch(/\$10 \/ month or \$110 \/ year/);
  });
});
