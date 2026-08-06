const {
  FY_YEARS_BACK,
  FY_YEARS_FORWARD,
  formatFinancialYearValue,
  getCurrentFinancialYear,
  buildFinancialYearWindow,
  isFinancialYearInWindow,
  ensureSelectedFinancialYear,
} = require("./lib/fy-window");

describe("fy-window", () => {
  it("uses 6 past + current + 3 future around the current Australian FY", () => {
    expect(FY_YEARS_BACK).toBe(6);
    expect(FY_YEARS_FORWARD).toBe(3);

    // 6 Aug 2026 → FY 2026-27
    const mid = new Date(2026, 7, 6);
    expect(getCurrentFinancialYear(mid)).toBe("2026-27");
    expect(buildFinancialYearWindow({ now: mid })).toEqual([
      "2029-30",
      "2028-29",
      "2027-28",
      "2026-27",
      "2025-26",
      "2024-25",
      "2023-24",
      "2022-23",
      "2021-22",
      "2020-21",
    ]);
  });

  it("rolls the window forward after 1 July", () => {
    // 30 Jun 2027 still FY 2026-27; 1 Jul 2027 → FY 2027-28
    expect(getCurrentFinancialYear(new Date(2027, 5, 30))).toBe("2026-27");
    expect(getCurrentFinancialYear(new Date(2027, 6, 1))).toBe("2027-28");

    const afterJuly = buildFinancialYearWindow({ now: new Date(2027, 6, 1) });
    expect(afterJuly[0]).toBe("2030-31");
    expect(afterJuly).toContain("2027-28");
    expect(afterJuly).toContain("2021-22");
    expect(afterJuly).not.toContain("2020-21");
  });

  it("formats and membership helpers", () => {
    expect(formatFinancialYearValue(2026)).toBe("2026-27");
    expect(isFinancialYearInWindow("2026-27", { now: new Date(2026, 7, 6) })).toBe(true);
    expect(isFinancialYearInWindow("2015-16", { now: new Date(2026, 7, 6) })).toBe(false);
  });

  it("can keep a selected FY that sits outside the default window", () => {
    const base = buildFinancialYearWindow({ now: new Date(2026, 7, 6) });
    const withOld = ensureSelectedFinancialYear(base, "2018-19");
    expect(withOld).toContain("2018-19");
    expect(withOld[0]).toBe("2029-30");
    expect(withOld[withOld.length - 1]).toBe("2018-19");
  });
});
