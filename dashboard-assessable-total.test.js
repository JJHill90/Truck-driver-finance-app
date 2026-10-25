const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");

describe("dashboard assessableTotal guard", () => {
  it("does not stub GET /summary with { ok: true, quiet: true }", () => {
    expect(src).toMatch(/function isUsableSummary/);
    expect(src).toMatch(/function patchRenderStats/);
    expect(src).toMatch(/function patchRefreshEofyLive/);
    expect(src).toMatch(/Do not stub \/summary/);
    expect(src).toMatch(/haulage\\\/\(report\|forecast\)/);
    expect(src).not.toMatch(/summary\|report\|forecast/);
  });

  it("keeps last good summary and re-renders after the quiet window", () => {
    expect(src).toMatch(/lastSummaryBody/);
    expect(src).toMatch(/function scheduleTotalsSyncAfterQuiet/);
    expect(src).toMatch(/__haulageTotalsSyncTimer/);
    expect(src).toMatch(/s\.income\.assessableTotal/);
  });

  it("cache-busts enhancements so Play WebViews load the guard", () => {
    expect(hub).toMatch(/enhancements\.js\?v=accountant-pack-1/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=accountant-pack-1/);
  });
});
