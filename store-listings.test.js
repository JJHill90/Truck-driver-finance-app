const fs = require("fs");
const path = require("path");

const STORE = path.join(__dirname, "mobile-suite", "store");
const IOS_PLIST = path.join(__dirname, "mobile-suite", "ios", "App", "App", "Info.plist");
const IOS_ADDITIONS = path.join(__dirname, "mobile-suite", "ios-info.plist.additions.xml");

function pngInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
  };
}

describe("Suite store listing assets", () => {
  it("ships a 1024×500 Play feature graphic with no alpha", () => {
    expect(pngInfo(path.join(STORE, "feature-graphic-1024x500.png"))).toMatchObject({
      width: 1024,
      height: 500,
      colorType: 2,
    });
  });

  it("keeps camera + export-compliance keys on the iOS project", () => {
    const plist = fs.readFileSync(IOS_PLIST, "utf8");
    const additions = fs.readFileSync(IOS_ADDITIONS, "utf8");
    for (const text of [plist, additions]) {
      expect(text).toMatch(/NSCameraUsageDescription/);
      expect(text).toMatch(/NSPhotoLibraryUsageDescription/);
      expect(text).toMatch(/ITSAppUsesNonExemptEncryption/);
      expect(text).toMatch(/photograph receipts and payslips/i);
    }
    expect(plist).toMatch(/Go Taxation Suite/);
    expect(plist).toMatch(/<false\/>/);
  });

  it("ships an iOS privacy manifest and is iPhone-only for first submission", () => {
    const manifest = fs.readFileSync(
      path.join(__dirname, "mobile-suite", "ios", "App", "App", "PrivacyInfo.xcprivacy"),
      "utf8"
    );
    const pbx = fs.readFileSync(
      path.join(__dirname, "mobile-suite", "ios", "App", "App.xcodeproj", "project.pbxproj"),
      "utf8"
    );
    expect(manifest).toMatch(/NSPrivacyTracking/);
    expect(manifest).toMatch(/<false\/>/);
    expect(manifest).toMatch(/NSPrivacyAccessedAPICategoryUserDefaults/);
    expect(pbx).toMatch(/PrivacyInfo\.xcprivacy/);
    expect(pbx).toMatch(/TARGETED_DEVICE_FAMILY = 1;/);
    expect(pbx).not.toMatch(/TARGETED_DEVICE_FAMILY = "1,2"/);
  });

  it("has Play and App Store phone screenshots at required sizes", () => {
    const playDir = path.join(STORE, "screenshots", "play-1080x1920");
    const iosDir = path.join(STORE, "screenshots", "appstore-1290x2796");
    const names = ["01-login.png", "02-dashboard.png", "03-expenses.png", "04-income.png", "05-report.png"];
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const name of names) {
      expect(pngInfo(path.join(playDir, name))).toMatchObject({
        width: 1080,
        height: 1920,
        colorType: 2,
      });
      expect(pngInfo(path.join(iosDir, name))).toMatchObject({
        width: 1290,
        height: 2796,
        colorType: 2,
      });
    }
  });
});
