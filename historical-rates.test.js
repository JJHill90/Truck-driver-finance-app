const {
  incomeTaxForYear,
  centsPerKmForYear,
  budgetRepairLevy,
  sgRateForYear,
  applyHistoricalRates,
  travelRatesForYear,
  getSalaryBandForYear,
} = require("./lib/historical-rates");

describe("incomeTaxForYear (verified ATO brackets)", () => {
  it("uses 2016-17 brackets (19% to 37k, 32.5% to 87k)", () => {
    // taxable 50,200: 18,800*0.19 + 13,200*0.325 = 3,572 + 4,290 = 7,862
    expect(incomeTaxForYear(50200, "2016-17")).toBeCloseTo(7862, 2);
  });
  it("uses 2019-20 brackets (32.5% band to 90k)", () => {
    // 90,000: 18,800*0.19 + 53,000*0.325 = 3,572 + 17,225 = 20,797
    expect(incomeTaxForYear(90000, "2019-20")).toBeCloseTo(20797, 0);
  });
  it("uses 2022-23 stage-2 brackets (19% to 45k)", () => {
    // 45,000: 26,800*0.19 = 5,092
    expect(incomeTaxForYear(45000, "2022-23")).toBeCloseTo(5092, 0);
  });
  it("uses 2024-25+ stage-3 brackets (16% to 45k, 30% to 135k)", () => {
    // 50,200: 26,800*0.16 + 5,200*0.30 = 4,288 + 1,560 = 5,848
    expect(incomeTaxForYear(50200, "2025-26")).toBeCloseTo(5848, 2);
  });
});

describe("centsPerKmForYear", () => {
  it("returns the right rate per year", () => {
    expect(centsPerKmForYear("2016-17")).toBe(0.66);
    expect(centsPerKmForYear("2019-20")).toBe(0.68);
    expect(centsPerKmForYear("2021-22")).toBe(0.72);
    expect(centsPerKmForYear("2022-23")).toBe(0.78);
    expect(centsPerKmForYear("2023-24")).toBe(0.85);
    expect(centsPerKmForYear("2025-26")).toBe(0.88);
    expect(centsPerKmForYear("2026-27")).toBe(0.91);
  });
});

describe("budgetRepairLevy", () => {
  it("applies 2% over $180k for 2015-16 and 2016-17 only", () => {
    expect(budgetRepairLevy(200000, "2015-16")).toBeCloseTo(400, 2);
    expect(budgetRepairLevy(200000, "2016-17")).toBeCloseTo(400, 2);
    expect(budgetRepairLevy(200000, "2017-18")).toBe(0);
    expect(budgetRepairLevy(150000, "2015-16")).toBe(0);
  });
});

describe("sgRateForYear", () => {
  it("tracks the SG rate history", () => {
    expect(sgRateForYear("2019-20")).toBe(0.095);
    expect(sgRateForYear("2021-22")).toBe(0.1);
    expect(sgRateForYear("2023-24")).toBe(0.11);
    expect(sgRateForYear("2024-25")).toBe(0.115);
    expect(sgRateForYear("2025-26")).toBe(0.12);
  });
});

describe("travelRatesForYear", () => {
  it("returns TD 2021/6 truck meals for 2021-22 and earlier", () => {
    const r = travelRatesForYear("2021-22");
    expect(r.determination).toBe("TD 2021/6");
    expect(r.truckDriverMealsDailyTotal).toBe(107.5);
    expect(r.overtimeMealCap).toBe(32.5);
    expect(travelRatesForYear("2020-21").determination).toBe("TD 2021/6");
  });

  it("returns TD 2022/10 truck meals for 2022-23", () => {
    const r = travelRatesForYear("2022-23");
    expect(r.determination).toBe("TD 2022/10");
    expect(r.truckDriverMealsDailyTotal).toBe(110.15);
    expect(r.overtimeMealCap).toBe(33.25);
  });

  it("returns TD 2023/3 truck meals for 2023-24", () => {
    const r = travelRatesForYear("2023-24");
    expect(r.determination).toBe("TD 2023/3");
    expect(r.truckDriverMealsDailyTotal).toBe(118.15);
    expect(r.overtimeMealCap).toBe(35.65);
  });

  it("returns TD 2024/3 truck meals for 2024-25", () => {
    const r = travelRatesForYear("2024-25");
    expect(r.determination).toBe("TD 2024/3");
    expect(r.truckDriverMealsDailyTotal).toBe(124.75);
    expect(r.overtimeMealCap).toBe(37.65);
    expect(r.truckDriverMeals.breakfast.cap).toBe(30.35);
    expect(getSalaryBandForYear(143650, "2024-25")).toBe("band1");
    expect(getSalaryBandForYear(143651, "2024-25")).toBe("band2");
  });

  it("returns TD 2025/4 truck meals for 2025-26", () => {
    const r = travelRatesForYear("2025-26");
    expect(r.determination).toBe("TD 2025/4");
    expect(r.truckDriverMealsDailyTotal).toBe(128);
    expect(r.overtimeMealCap).toBe(38.65);
    expect(getSalaryBandForYear(148250, "2025-26")).toBe("band1");
    expect(getSalaryBandForYear(148251, "2025-26")).toBe("band2");
  });

  it("returns TD 2026/4 truck meals for 2026-27 onwards", () => {
    const r = travelRatesForYear("2026-27");
    expect(r.determination).toBe("TD 2026/4");
    expect(r.truckDriverMealsDailyTotal).toBe(132.5);
    expect(r.overtimeMealCap).toBe(40);
    expect(r.truckDriverMeals.breakfast.cap).toBe(32.25);
    expect(getSalaryBandForYear(153210, "2026-27")).toBe("band1");
    expect(getSalaryBandForYear(153211, "2026-27")).toBe("band2");
    expect(travelRatesForYear("2027-28").determination).toBe("TD 2026/4");
  });
});

describe("applyHistoricalRates", () => {
  it("recomputes the tax estimate with the selected year's rates", () => {
    // Base summary as the provided engine would produce (current-rate tax).
    const summary = {
      financialYear: "2016-17",
      income: { assessableTotal: 52000, grossTotal: 52000, breakdown: [] },
      expenses: { deductibleTotal: 1800, grossTotal: 1800, breakdown: [{ category: "fuel", deductibleTotal: 1800, count: 1 }] },
      taxEstimate: { taxableIncome: 50200, incomeTax: 5848, medicareLevy: 1004, totalTax: 6852, effectiveRate: 13.18 },
    };
    const records = { expenses: [{ date: "2016-08-15", category: "fuel", amount: 1800, workUsePercent: 100 }] };
    applyHistoricalRates(summary, records, "2016-17");
    expect(summary.taxEstimate.taxableIncome).toBe(50200);
    expect(summary.taxEstimate.incomeTax).toBeCloseTo(7862, 2); // 2016-17 rates, not current
    expect(summary.taxEstimate.totalTax).toBeCloseTo(8866, 2); // + 2% Medicare
    expect(summary.taxEstimate.ratesFinancialYear).toBe("2016-17");
  });

  it("applies the year's cents-per-km rate to car claims", () => {
    const summary = {
      financialYear: "2016-17",
      income: { assessableTotal: 0, grossTotal: 0, breakdown: [] },
      expenses: { deductibleTotal: 0, grossTotal: 0, breakdown: [{ category: "vehicle_car", deductibleTotal: 0, count: 1 }] },
      taxEstimate: {},
    };
    const records = {
      expenses: [{ date: "2016-09-01", category: "vehicle_car", method: "cents_per_km", kilometres: 1000 }],
    };
    applyHistoricalRates(summary, records, "2016-17");
    // 1000 km * $0.66 (2016-17 rate) = $660
    expect(summary.expenses.deductibleTotal).toBe(660);
  });

  it("overlays FY travel / LAFHA allowances onto the summary", () => {
    const summary = {
      financialYear: "2026-27",
      profile: { annualSalary: 85000 },
      income: { assessableTotal: 85000, grossTotal: 85000, breakdown: [] },
      expenses: { deductibleTotal: 0, grossTotal: 0, breakdown: [] },
      allowances: {},
      taxEstimate: {},
    };
    applyHistoricalRates(summary, { expenses: [] }, "2026-27");
    expect(summary.allowances.determination).toBe("TD 2026/4");
    expect(summary.allowances.maxDailyMealsPotential).toBe(132.5);
    expect(summary.allowances.overtimeMealCap).toBe(40);
    expect(summary.profile.salaryBand).toBe("band1");
  });
});
