const {
  calcMarginalTax,
  calcMedicareLevy,
  calcExpenseDeduction,
  calcIncomeAssessability,
  summariseYear,
  buildAccountantReport,
} = require("./lib/tax-calculator");
const { buildForecast } = require("./lib/forecast");

describe("calcMarginalTax (2025-26 brackets)", () => {
  it("is zero under the tax-free threshold", () => {
    expect(calcMarginalTax(18200)).toBe(0);
  });
  it("applies the 16% bracket up to $45k", () => {
    expect(calcMarginalTax(45000)).toBeCloseTo(4288, 0);
  });
  it("applies the 30% and higher brackets", () => {
    expect(calcMarginalTax(135000)).toBeCloseTo(31288, 0);
    expect(calcMarginalTax(200000)).toBeCloseTo(56138, 0);
  });
});

describe("calcMedicareLevy", () => {
  it("is 2% of taxable income", () => {
    expect(calcMedicareLevy(100000)).toBe(2000);
    expect(calcMedicareLevy(0)).toBe(0);
  });
});

describe("calcExpenseDeduction", () => {
  it("applies work-use percentage", () => {
    const r = calcExpenseDeduction({ category: "phone_internet", amount: 100, workUsePercent: 80 });
    expect(r.deductibleAmount).toBe(80);
  });
  it("caps meals at the ATO reasonable amount", () => {
    const r = calcExpenseDeduction({ category: "meals_dinner", amount: 200 });
    expect(r.deductibleAmount).toBe(61.3);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("zeroes reimbursed expenses", () => {
    const r = calcExpenseDeduction({ category: "fuel", amount: 100, reimbursed: true });
    expect(r.deductibleAmount).toBe(0);
  });
  it("caps cents-per-km car claims at 5000 km", () => {
    const r = calcExpenseDeduction({ category: "vehicle_car", method: "cents_per_km", kilometres: 6000 });
    expect(r.deductibleAmount).toBe(4400);
  });
});

describe("calcIncomeAssessability", () => {
  it("treats reimbursements as non-assessable", () => {
    expect(calcIncomeAssessability({ type: "reimbursement", amount: 500 }).assessable).toBe(0);
  });
  it("only assesses if_claiming allowances when claiming", () => {
    expect(calcIncomeAssessability({ type: "allowance_travel", amount: 500 }).assessable).toBe(0);
    expect(
      calcIncomeAssessability({ type: "allowance_travel", amount: 500, claimingDeduction: true }).assessable
    ).toBe(500);
  });
});

describe("summariseYear", () => {
  const records = {
    expenses: [
      { id: "e1", date: "2025-08-02", category: "fuel", amount: 1000, workUsePercent: 100 },
      { id: "e2", date: "2024-08-02", category: "fuel", amount: 5000, workUsePercent: 100 },
    ],
    income: [{ id: "i1", date: "2025-08-01", type: "salary_wages", amount: 90000 }],
  };
  const profile = { financialYear: "2025-26", annualSalary: 90000, driverType: "long_haul" };

  it("filters rows to the selected financial year", () => {
    const s = summariseYear(records, profile);
    expect(s.income.assessableTotal).toBe(90000);
    expect(s.expenses.deductibleTotal).toBe(1000);
    expect(s.taxEstimate.taxableIncome).toBe(89000);
  });

  it("exposes salary-band travel caps", () => {
    const s = summariseYear(records, profile);
    expect(s.profile.salaryBand).toBe("band1");
    expect(s.allowances.domesticTravelCaps.accommodation).toBeGreaterThan(0);
  });
});

describe("buildAccountantReport", () => {
  it("wraps a summary with report metadata", () => {
    const r = buildAccountantReport(
      { expenses: [], income: [] },
      { name: "Test Driver", financialYear: "2025-26" }
    );
    expect(r.title).toMatch(/Haulage/i);
    expect(r.driver.name).toBe("Test Driver");
    expect(r.summary.financialYear).toBe("2025-26");
  });
});

describe("buildForecast", () => {
  it("returns manual projections with three scenarios", () => {
    const f = buildForecast(
      { expenses: [], income: [] },
      { financialYear: "2025-26" },
      { mode: "manual", projectedIncome: 120000, projectedDeductions: 8000 }
    );
    expect(f.projected.income).toBe(120000);
    expect(f.scenarios).toHaveLength(3);
  });
});
