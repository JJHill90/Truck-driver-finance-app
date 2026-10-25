const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");

describe("Suite scan fixes on Taxation Hub", () => {
  it("treats Driver Hub and Suite Play WebViews as native shells", () => {
    expect(src).toMatch(/function isNativeAppUserAgent/);
    expect(src).toMatch(/DriverHubApp\|GoTaxationSuiteApp/);
    expect(src).toMatch(/function isNativeShell/);
    expect(src).toMatch(/function isAndroidLike/);
    expect(src.indexOf("isNativeAppUserAgent")).toBeLessThan(src.indexOf("function isAndroidLike"));
    expect(src).toMatch(/haulageIsNativeShell = isNativeShell/);
  });

  it("keeps Suite PDF isolate wired for income and expenses", () => {
    expect(src).toMatch(/function uploadIncomePdf/);
    expect(src).toMatch(/function copyPdfToMemory/);
    expect(src).toMatch(/function quietUiAfterScanSave/);
    expect(src).toMatch(/__haulagePdfIsolate/);
    expect(src).toMatch(/Opening it inside the app can freeze Android/);
  });

  it("adds Scan with camera on Hub and Suite income, same as expenses", () => {
    expect(hub).toMatch(/id="pick-income-camera"/);
    expect(suiteHtml).toMatch(/id="pick-income-camera"/);
    expect(hub).toMatch(/id="pick-receipt-camera"/);
    expect(suiteHtml).toMatch(/id="pick-receipt-camera"/);
    expect(src).toMatch(/getElementById\("pick-income-camera"\)/);
    expect(src).toMatch(/openCamera\("income"\)/);
    expect(src).toMatch(/uploadIncomeFile/);
    expect(src).toMatch(/payslip-scan-\$/);
  });

  it("force-closes the camera overlay like the receipt photo viewer", () => {
    expect(src).toMatch(/function forceCloseCamera/);
    expect(src).toMatch(/function bindCameraClose/);
    expect(src).toMatch(/#receipt-camera-cancel-top/);
    expect(src).toMatch(/receipt-camera-close/);
  });

  it("cache-busts enhancements so Play WebViews load the Suite port", () => {
    expect(hub).toMatch(/enhancements\.js\?v=accountant-pack-2/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=accountant-pack-2/);
  });
});
