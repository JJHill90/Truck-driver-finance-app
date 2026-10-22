const fs = require("fs");
const path = require("path");

describe("dashboard assessableTotal guard", () => {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");

  it("wraps renderStats so a quiet/partial summary cannot throw", () => {
    expect(src).toMatch(/function ensureSummaryShape/);
    expect(src).toMatch(/function safeRenderStats/);
    expect(src).toMatch(/function quietSummaryStub/);
    expect(src).toMatch(/s\.income = \{ grossTotal: 0, assessableTotal: 0, breakdown: \[\] \}/);
    expect(src).toMatch(/typeof state !== "undefined" \? state\.summary/);
  });

  it("quiet /summary stub includes income.assessableTotal", () => {
    expect(src).toMatch(/function cachedQuietForecastResponse\(url\)/);
    const start = src.indexOf("function cachedQuietForecastResponse");
    const chunk = src.slice(start, start + 800);
    expect(chunk).toMatch(/quietSummaryStub/);
    expect(chunk).not.toMatch(/JSON\.stringify\(\{ ok: true, quiet: true \}\)/);
    expect(src).toMatch(
      /if \(!\(Number\(window\.__haulageQuietUntil\) > Date\.now\(\)\)\) return false;/
    );
  });

  it("ensureSummaryShape fills income on a quiet stub", () => {
    const start = src.indexOf("function ensureSummaryShape");
    const end = src.indexOf("function wrapNamed", start);
    // eslint-disable-next-line no-new-func
    const ensure = new Function(`${src.slice(start, end)}; return ensureSummaryShape;`)();
    const quiet = { ok: true, quiet: true };
    ensure(quiet);
    expect(quiet.income.assessableTotal).toBe(0);
    expect(quiet.income.breakdown).toEqual([]);
    expect(quiet.taxEstimate.totalTax).toBe(0);
    expect(quiet.profile.salaryBand).toBe("band1");
  });
});
