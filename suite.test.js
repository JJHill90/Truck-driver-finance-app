const suite = require("./lib/suite");
const { calcLito, calcMedicareLevyShaded, homeOfficeRateForYear } = require("./lib/suite/ato");

describe("Go Taxation Suite entity types", () => {
  it("maps trucking driver types onto employee", () => {
    expect(suite.normalizeEntityType("long_haul")).toBe("employee");
    expect(suite.normalizeEntityType("sole_trader")).toBe("sole_trader");
    expect(suite.normalizeEntityType("partnership")).toBe("partnership");
  });

  it("lists employee vs sole-trader income types", () => {
    const emp = suite.listMenuIncomeTypes("employee").map((t) => t.id);
    const st = suite.listMenuIncomeTypes("sole_trader").map((t) => t.id);
    expect(emp).toContain("salary_wages");
    expect(emp).not.toContain("business_income");
    expect(st).toContain("business_income");
    expect(st).toContain("salary_wages");
  });

  it("hides business-only expenses from employees", () => {
    const emp = suite.listMenuCategories("employee").map((c) => c.id);
    expect(emp).toContain("home_office_hours");
    expect(emp).toContain("donations_dgr");
    expect(emp).toContain("tax_affairs");
    expect(emp).not.toContain("advertising");
    expect(emp).not.toContain("stock_cogs");
    expect(suite.listMenuCategories("sole_trader").map((c) => c.id)).toContain("advertising");
  });
});

describe("suite tax engine", () => {
  it("applies LITO and Medicare shade-in for a PAYG employee", () => {
    const records = {
      income: [{ id: "i1", date: "2025-08-01", type: "salary_wages", amount: 40000, taxWithheld: 4000 }],
      expenses: [
        { id: "e1", date: "2025-08-02", category: "union_fees", amount: 500, workUsePercent: 100 },
      ],
    };
    const s = suite.summariseYear(records, {
      financialYear: "2025-26",
      entityType: "employee",
      annualSalary: 40000,
    });
    expect(s.income.assessableTotal).toBe(40000);
    expect(s.expenses.deductibleTotal).toBe(500);
    expect(s.taxEstimate.taxableIncome).toBe(39500);
    expect(s.taxEstimate.lito).toBe(calcLito(39500));
    expect(s.taxEstimate.lito).toBeGreaterThan(300);
    expect(s.taxEstimate.medicareLevy).toBe(calcMedicareLevyShaded(39500, "2025-26"));
    expect(s.income.paygWithheld).toBe(4000);
    expect(s.profile.entityType).toBe("employee");
    expect(s.allowances.determination).toMatch(/TD /);
    expect(s.entityNote).toMatch(/PAYG employee/i);
  });

  it("does not use truck-driver meal occupation labels", () => {
    const s = suite.summariseYear(
      { income: [], expenses: [] },
      { financialYear: "2025-26", entityType: "employee", annualSalary: 80000 }
    );
    expect(s.allowances.truckDriverMealsDaily.breakfast.label).toMatch(/work travel/i);
    expect(s.allowances.truckDriverMealsDaily.breakfast.label).not.toMatch(/truck/i);
  });

  it("caps travel dinner at the TD reasonable amount", () => {
    const r = suite.calcExpenseDeduction(
      { category: "meals_dinner", amount: 200, date: "2025-08-01" },
      { financialYear: "2025-26", annualSalary: 80000, entityType: "employee" }
    );
    expect(r.deductibleAmount).toBe(61.3);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("computes home-office hours at 70c for 2025-26", () => {
    expect(homeOfficeRateForYear("2025-26")).toBe(0.7);
    const r = suite.calcExpenseDeduction(
      { category: "home_office_hours", hours: 100, amount: 0, date: "2025-09-01" },
      { financialYear: "2025-26", entityType: "employee" }
    );
    expect(r.deductibleAmount).toBe(70);
  });

  it("treats reimbursements as non-deductible", () => {
    const r = suite.calcExpenseDeduction({
      category: "phone_internet",
      amount: 120,
      reimbursed: true,
    });
    expect(r.deductibleAmount).toBe(0);
  });

  it("keeps reimbursements out of assessable income", () => {
    expect(suite.summariseYear(
      {
        income: [{ id: "i", date: "2025-08-01", type: "reimbursement", amount: 900 }],
        expenses: [],
      },
      { financialYear: "2025-26", entityType: "employee" }
    ).income.assessableTotal).toBe(0);
  });

  it("summarises sole-trader business income minus expenses", () => {
    const s = suite.summariseYear(
      {
        income: [{ id: "i", date: "2025-08-01", type: "business_income", amount: 120000, gstAmount: 10000 }],
        expenses: [
          { id: "e", date: "2025-08-02", category: "advertising", amount: 4000, workUsePercent: 100 },
        ],
      },
      { financialYear: "2025-26", entityType: "sole_trader", gstRegistered: true, annualSalary: 120000 }
    );
    expect(s.income.assessableTotal).toBe(120000);
    expect(s.expenses.deductibleTotal).toBe(4000);
    expect(s.taxEstimate.taxableIncome).toBe(116000);
    expect(s.bas.netGst).toBe(10000);
    expect(s.entityNote).toMatch(/Sole trader/i);
  });

  it("applies partnership share to distributions when asked", () => {
    const s = suite.summariseYear(
      {
        income: [
          {
            id: "i",
            date: "2025-08-01",
            type: "partnership_distribution",
            amount: 80000,
          },
        ],
        expenses: [],
      },
      { financialYear: "2025-26", entityType: "partnership", partnerSharePercent: 50 }
    );
    expect(s.income.assessableTotal).toBe(40000);
  });

  it("builds an EOFY report without linehaul branding", () => {
    const report = suite.buildAccountantReport(
      {
        income: [{ id: "i", date: "2025-08-01", type: "salary_wages", amount: 70000 }],
        expenses: [],
      },
      { financialYear: "2025-26", name: "Alex Nguyen", entityType: "employee" }
    );
    expect(report.title).toMatch(/Employee \(PAYG\)/);
    expect(report.title).not.toMatch(/Linehaul|truck|driver/i);
    expect(report.driver.driverTypeLabel).toMatch(/Employee/);
    expect(report.disclaimer).toMatch(/not occupation-specific truck-driver/i);
  });
});

describe("suite scan breakdown", () => {
  it("does not add a truck-driver LAFHA estimate on a PAYG payslip", () => {
    const result = suite.analyzeScan(
      {
        documentType: "income",
        grossTotal: 2000,
        netPay: 1500,
        lineItems: [
          { description: "Gross wages", amount: 2000 },
          { description: "PAYG tax withheld", amount: 400 },
        ],
      },
      "income",
      { entityType: "employee", driverType: "employee", financialYear: "2025-26" }
    );
    const lafha = (result.componentBreakdown || []).filter((c) => c.type === "overnight_allowance");
    expect(lafha).toHaveLength(0);
    expect(result.compliance.checks.some((c) => /PAYG/i.test(c.name))).toBe(true);
  });
});

describe("suite product detection", () => {
  it("detects the suite cookie and /suite referer", () => {
    expect(suite.productOf({ headers: { cookie: "gotax_product=1" } })).toBe("suite");
    expect(suite.productOf({ headers: { referer: "http://localhost:3000/suite/" } })).toBe("suite");
    expect(suite.productOf({ headers: { cookie: "" } })).toBe("haulage");
  });
});
