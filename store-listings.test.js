const fs = require("fs");
const path = require("path");

const STORE = path.join(__dirname, "mobile-suite", "store");
const STORE_LISTING = path.join(__dirname, "docs", "store-listing.md");
const CAP_CONFIG = path.join(__dirname, "mobile-suite", "capacitor.config.json");
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

describe("Driver Hub store listing assets", () => {
  const hubStore = path.join(__dirname, "mobile", "store");
  const hubListing = path.join(__dirname, "docs", "store-listing-driverhub.md");
  const hubCap = path.join(__dirname, "mobile", "capacitor.config.json");
  const hubAndroid = path.join(__dirname, "mobile", "android", "app");

  it("lists Hub HTTPS marketing and legal pages", () => {
    const listing = fs.readFileSync(hubListing, "utf8");
    expect(listing).toMatch(/https:\/\/www\.godriverhub\.com\/haulage\/privacy|https:\/\/godriverhub\.com\/haulage\/privacy/);
    expect(listing).toMatch(/https:\/\/www\.godriverhub\.com\/haulage\/terms|https:\/\/godriverhub\.com\/haulage\/terms/);
    expect(listing).toMatch(/https:\/\/www\.godriverhub\.com\/support|https:\/\/godriverhub\.com\/support/);
    expect(listing).toMatch(/https:\/\/www\.godriverhub\.com\/haulage\//);
    expect(listing).toMatch(/gotaxation\.com\.au/);
    expect(listing).toMatch(/marketing site/);
    const cap = JSON.parse(fs.readFileSync(hubCap, "utf8"));
    expect(cap.server.url).toBeFalsy();
    expect(cap.server.androidScheme).toBe("https");
    expect(cap.server.allowNavigation).toEqual(
      expect.arrayContaining([
        "https://godriverhub.com/haulage*",
        "https://www.godriverhub.com/haulage*",
        "https://godriverhub.com/api/haulage*",
        "https://www.godriverhub.com/api/haulage*",
      ])
    );
    expect(cap.server.allowNavigation.join("\n")).not.toMatch(/godriverhub\.com\/\*/);
  });

  it("ships a 1024×500 Play feature graphic with no alpha", () => {
    expect(pngInfo(path.join(hubStore, "feature-graphic-1024x500.png"))).toMatchObject({
      width: 1024,
      height: 500,
      colorType: 2,
    });
  });

  it("keeps the Play short description at or under 80 characters", () => {
    const listing = fs.readFileSync(hubListing, "utf8");
    const match = listing.match(/\*\*Short \(Play, ≤80\):\*\*[^\n]*\n+([^\n]+)/);
    expect(match).toBeTruthy();
    expect(match[1].trim().length).toBeGreaterThan(20);
    expect(match[1].trim().length).toBeLessThanOrEqual(80);
  });

  it("ships a 512 Play icon", () => {
    expect(pngInfo(path.join(hubStore, "icon-play-512.png"))).toMatchObject({
      width: 512,
      height: 512,
    });
  });

  it("has Play phone screenshots at 1080×1920", () => {
    const playDir = path.join(hubStore, "screenshots", "play-1080x1920");
    const names = ["01-login.png", "02-dashboard.png", "03-expenses.png", "04-income.png", "05-report.png"];
    for (const name of names) {
      expect(pngInfo(path.join(playDir, name))).toMatchObject({
        width: 1080,
        height: 1920,
        colorType: 2,
      });
    }
  });

  it("uses a color Android 12 splash and does not proxy via server.url", () => {
    const styles = fs.readFileSync(path.join(hubAndroid, "src/main/res/values/styles.xml"), "utf8");
    expect(styles).toMatch(/windowSplashScreenBackground">@color\/splashBackground/);
    expect(styles).not.toMatch(/android:background">@drawable\/splash/);
    const colors = fs.readFileSync(path.join(hubAndroid, "src/main/res/values/colors.xml"), "utf8");
    expect(colors).toMatch(/name="splashBackground">#0B1F33/);
    const raw = fs.readFileSync(path.join(hubAndroid, "src/main/assets/capacitor.config.json"), "utf8");
    const config = JSON.parse(raw);
    expect(config.appId).toBe("com.haulagefinance.app");
    expect(config.server && config.server.url).toBeFalsy();
    const main = fs.readFileSync(
      path.join(hubAndroid, "src/main/java/com/haulagefinance/app/MainActivity.java"),
      "utf8"
    );
    expect(main).toMatch(/https:\/\/www\.godriverhub\.com\/haulage\//);
    expect(main).toMatch(/SplashScreen\.installSplashScreen/);
    expect(main).toMatch(/DriverHubApp/);
    expect(main).toMatch(/url\.contains\("\/haulage"\)/);
    const plugin = fs.readFileSync(
      path.join(hubAndroid, "src/main/java/com/haulagefinance/app/HubNavigationPlugin.java"),
      "utf8"
    );
    expect(plugin).toMatch(/shouldOverrideLoad/);
    expect(plugin).toMatch(/isAppPath/);
    expect(plugin).toMatch(/bounceToApp/);
    expect(plugin).toMatch(/isLocalHost/);
    expect(plugin).not.toMatch(/gotaxation\.com\.au/);
    const launcher = fs.readFileSync(path.join(hubAndroid, "src/main/assets/public/index.html"), "utf8");
    expect(launcher).toMatch(/https:\/\/www\.godriverhub\.com\/haulage\//);
    expect(launcher).toMatch(/Try again/);
    const gradle = fs.readFileSync(path.join(hubAndroid, "build.gradle"), "utf8");
    expect(gradle).toMatch(/versionCode 3/);
    expect(gradle).toMatch(/versionName "1\.0\.2"/);
  });
});

describe("Suite store listing assets", () => {
  it("lists the official HTTPS domain for marketing and legal pages", () => {
    const listing = fs.readFileSync(STORE_LISTING, "utf8");
    expect(listing).toMatch(/https:\/\/gotaxationsuite\.com\/privacy/);
    expect(listing).toMatch(/https:\/\/gotaxationsuite\.com\/terms/);
    expect(listing).toMatch(/https:\/\/gotaxationsuite\.com\/support/);
    expect(listing).toMatch(/https:\/\/gotaxationsuite\.com\/\.well-known\/assetlinks\.json/);
    expect(listing).toMatch(/https:\/\/go-taxation-suite\.onrender\.com\/suite\//);
    expect(listing).toMatch(/https:\/\/gotaxationsuite\.com\//);
    const cap = JSON.parse(fs.readFileSync(CAP_CONFIG, "utf8"));
    expect(cap.server.url).toBeUndefined();
    expect(cap.server.androidScheme).toBe("https");
    expect(cap.server.allowNavigation).toEqual(
      expect.arrayContaining([
        "https://go-taxation-suite.onrender.com/*",
        "https://gotaxationsuite.com/*",
        "https://www.gotaxationsuite.com/*",
      ])
    );
  });

  it("ships a 1024×500 Play feature graphic with no alpha", () => {
    expect(pngInfo(path.join(STORE, "feature-graphic-1024x500.png"))).toMatchObject({
      width: 1024,
      height: 500,
      colorType: 2,
    });
  });

  it("keeps the Play feature graphic tagline in the generator", () => {
    const src = fs.readFileSync(path.join(STORE, "generate-icons.py"), "utf8");
    expect(src).toMatch(/Record your receipts and income with ease\./);
    expect(src).toMatch(/Take control so the ATO does not/);
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

describe("Suite Android launch shell", () => {
  const androidApp = path.join(__dirname, "mobile-suite", "android", "app");

  it("uses a color Android 12 splash (PNG backgrounds crash on launch)", () => {
    const styles = fs.readFileSync(
      path.join(androidApp, "src/main/res/values/styles.xml"),
      "utf8"
    );
    expect(styles).toMatch(/windowSplashScreenBackground">@color\/splashBackground/);
    expect(styles).toMatch(/windowSplashScreenAnimatedIcon">@drawable\/ic_launcher_foreground/);
    expect(styles).toMatch(/postSplashScreenTheme">@style\/AppTheme\.NoActionBar/);
    expect(styles).not.toMatch(/android:background">@drawable\/splash/);
    const colors = fs.readFileSync(
      path.join(androidApp, "src/main/res/values/colors.xml"),
      "utf8"
    );
    expect(colors).toMatch(/name="splashBackground">#0B1F33/);
  });

  it("does not proxy the hosted Suite URL through Capacitor server.url", () => {
    const raw = fs.readFileSync(
      path.join(androidApp, "src/main/assets/capacitor.config.json"),
      "utf8"
    );
    const config = JSON.parse(raw);
    expect(config.appId).toBe("com.gotaxation.suite");
    expect(config.server && config.server.url).toBeFalsy();
    const launcher = fs.readFileSync(
      path.join(androidApp, "src/main/assets/public/index.html"),
      "utf8"
    );
    expect(launcher).toMatch(/go-taxation-suite\.onrender\.com\/suite\//);
    expect(launcher).toMatch(/Try again/);
  });

  it("loads the hosted Suite in the WebView and dismisses the splash", () => {
    const main = fs.readFileSync(
      path.join(androidApp, "src/main/java/com/gotaxation/suite/MainActivity.java"),
      "utf8"
    );
    const plugin = fs.readFileSync(
      path.join(androidApp, "src/main/java/com/gotaxation/suite/SuiteNavigationPlugin.java"),
      "utf8"
    );
    expect(main).toMatch(/SplashScreen\.installSplashScreen\(this\)/);
    expect(main).toMatch(/setKeepOnScreenCondition/);
    expect(main).toMatch(/https:\/\/go-taxation-suite\.onrender\.com\/suite\//);
    expect(main).toMatch(/openHostedSuite/);
    expect(plugin).toMatch(/shouldOverrideLoad/);
    expect(plugin).toMatch(/go-taxation-suite\.onrender\.com/);
  });

  it("bumps the Play versionCode so testers can install the rebuild", () => {
    const gradle = fs.readFileSync(path.join(androidApp, "build.gradle"), "utf8");
    expect(gradle).toMatch(/versionCode 7/);
    expect(gradle).toMatch(/versionName "1\.0\.6"/);
  });
});

