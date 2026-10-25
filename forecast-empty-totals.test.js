const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");

describe("forecast projected totals guard", () => {
  it("does not stub GET /forecast with an empty { ok: true, quiet: true } body", () => {
    expect(src).toMatch(/function isUsableForecast/);
    expect(src).toMatch(/function patchRenderForecast/);
    expect(src).toMatch(/function patchLoadForecast/);
    expect(src).toMatch(/function restoreForecast/);
    expect(src).toMatch(/lastForecastBody/);
    expect(src).toMatch(/Never invent an empty/);
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*ok:\s*true,\s*quiet:\s*true\s*\}/);
    expect(src).toMatch(/projected\.income/);
    expect(src).toMatch(/app\.js keeps `state` in script scope/);
    expect(src).toMatch(/if \(window\.state && !isUsableForecast\(f\)\) return/);
  });

  it("keeps last good forecast so scenarios can re-render after the quiet window", () => {
    expect(src).toMatch(/Array\.isArray\(f\.scenarios\)/);
    expect(src).toMatch(/if \(isUsableForecast\(data\)\) lastForecastBody = text/);
    expect(src).toMatch(/restoreForecast\(prevForecast\)/);
  });

  it("cache-busts enhancements so Play WebViews load the forecast guard", () => {
    expect(hub).toMatch(/enhancements\.js\?v=suite-thumbs-1/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=suite-thumbs-1/);
  });
});
