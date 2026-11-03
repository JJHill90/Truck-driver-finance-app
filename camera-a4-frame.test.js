const fs = require("fs");
const path = require("path");

describe("A4 camera frame", () => {
  const js = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public/styles.css"), "utf8");

  it("offers an A4 invoice frame plus receipt and long-receipt shapes", () => {
    expect(js).toMatch(/data-camera-frame="a4"/);
    expect(js).toMatch(/data-camera-frame="receipt"/);
    expect(js).toMatch(/data-camera-frame="long"/);
    expect(js).toMatch(/A4 invoice/);
    expect(js).toMatch(/Long receipt/);
    expect(js).toMatch(/Fit the whole A4 page inside the amber frame/);
    expect(js).toMatch(/function applyCameraFrame/);
    expect(js).toMatch(/haulage-camera-frame/);
    expect(js).toMatch(/height: \{ ideal: 3840 \}/);
    expect(js).toMatch(/focusMode: "continuous"/);
  });

  it("sizes the default frame to A4 portrait and keeps the other shapes", () => {
    expect(css).toMatch(/aspect-ratio:\s*210\s*\/\s*297/);
    expect(css).toMatch(/\.receipt-camera-frame\[data-frame="receipt"\][\s\S]*aspect-ratio:\s*1\s*\/\s*2\.2/);
    expect(css).toMatch(/\.receipt-camera-frame\[data-frame="long"\][\s\S]*aspect-ratio:\s*1\s*\/\s*3\.5/);
    expect(css).toMatch(/\.receipt-camera-modes button\.is-on/);
  });
});
