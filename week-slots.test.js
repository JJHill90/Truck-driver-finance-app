const fs = require("fs");
const path = require("path");
const {
  weekStartMonday,
  weekEndSunday,
  fyForDate,
  weeksElapsedInFinancialYear,
} = require("./lib/week-slots");

describe("weeksElapsedInFinancialYear", () => {
  it("lists every Monday from FY start through the current week", () => {
    const weeks = weeksElapsedInFinancialYear("2026-27", new Date(2026, 9, 22));
    const starts = weeks.map((w) => w.start);
    expect(starts[0]).toBe("2026-06-29");
    expect(starts[starts.length - 1]).toBe("2026-10-19");
    expect(starts).toContain("2026-07-06");
    expect(starts).not.toContain("2026-10-26");
    expect(weeks[0].end).toBe("2026-07-05");
  });

  it("includes empty weeks so the dropdown exists before any receipt", () => {
    const weeks = weeksElapsedInFinancialYear("2026-27", new Date(2026, 6, 6));
    expect(weeks.map((w) => w.start)).toEqual(["2026-06-29", "2026-07-06"]);
  });

  it("lists a finished FY in full", () => {
    const weeks = weeksElapsedInFinancialYear("2025-26", new Date(2026, 9, 22));
    const starts = weeks.map((w) => w.start);
    expect(starts[0]).toBe(weekStartMonday("2025-07-01"));
    expect(starts[starts.length - 1]).toBe(weekStartMonday("2026-06-30"));
    expect(starts.length).toBeGreaterThan(50);
  });

  it("returns no weeks for a future FY that has not started", () => {
    expect(weeksElapsedInFinancialYear("2027-28", new Date(2026, 9, 22))).toEqual([]);
  });
});

describe("week helpers", () => {
  it("treats Monday as the week start", () => {
    expect(weekStartMonday("2026-10-22")).toBe("2026-10-19");
    expect(weekEndSunday("2026-10-19")).toBe("2026-10-25");
    expect(fyForDate("2026-10-22")).toBe("2026-27");
    expect(fyForDate("2026-06-30")).toBe("2025-26");
  });
});

describe("ledger week dropdown wiring", () => {
  it("fills FY and week pickers even when the expense table is missing", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(src).toMatch(/function weeksElapsedInFinancialYear/);
    expect(src).toMatch(/function fallbackFyOptionsHtml/);
    expect(src).toMatch(/function seedElapsedWeeks/);
    const apply = src.slice(src.indexOf("function applyLedgerFilters"));
    expect(apply.indexOf("syncWeekOptions")).toBeGreaterThan(-1);
    expect(apply.indexOf("syncWeekOptions")).toBeLessThan(apply.indexOf("if (!table)"));
  });
});
