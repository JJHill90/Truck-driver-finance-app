const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "public", "enhancements.js"), "utf8");

describe("forecast quiet-window stub", () => {
  it("treats an unset quiet deadline as inactive (NaN <= now is false)", () => {
    expect(Number(undefined) <= Date.now()).toBe(false);
    expect(Number(undefined) > Date.now()).toBe(false);
    expect(src).toMatch(/function isQuietWindowActive/);
    expect(src).toMatch(/Number\(window\.__haulageQuietUntil\) > Date\.now\(\)/);
    expect(src).toMatch(/if \(!isQuietWindowActive\(\)\) return false;/);
    expect(src).not.toMatch(/Number\(window\.__haulageQuietUntil\) <= Date\.now\(\)/);
  });

  it("does not stub GET /forecast with { ok: true, quiet: true }", () => {
    expect(src).toMatch(/function isUsableForecast/);
    expect(src).toMatch(/function patchRenderForecast/);
    expect(src).toMatch(/lastForecastBody/);
    expect(src).toMatch(/Never invent an empty \{ ok: true, quiet: true \}/);
    expect(src).not.toMatch(/JSON\.stringify\(\{ ok: true, quiet: true \}\)/);
  });

  it("cache-busts enhancements so Play WebViews load the forecast guard", () => {
    const hub = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
    const suiteHtml = fs.readFileSync(path.join(__dirname, "public", "suite", "index.html"), "utf8");
    expect(hub).toMatch(/enhancements\.js\?v=direct-plus-1/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=direct-plus-1/);
  });
});
