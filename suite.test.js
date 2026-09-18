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
    expect(s.allowances.travelKind).toBe("ordinary_employee");
    expect(s.allowances.workTravelMealsDaily.dinner.cap).toBe(66.65);
    expect(s.allowances.dailyTravelTotal).toBe(338);
    expect(s.allowances.domesticTravelCaps.accommodation).toBe(173);
    expect(s.allowances.domesticTravelCaps.incidentals).toBe(24.5);
    expect(s.allowances.lafhaWeekly.oneAdult).toBe(341);
    expect(s.allowances.lafhaWeekly.determination).toBe("TD 2025/2");
  });

  it("caps travel dinner at the TD reasonable amount", () => {
    const r = suite.calcExpenseDeduction(
      { category: "meals_dinner", amount: 200, date: "2025-08-01" },
      { financialYear: "2025-26", annualSalary: 80000, entityType: "employee" }
    );
    expect(r.deductibleAmount).toBe(66.65);
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

describe("suite work travel nights and ordinary-employee LAFHA", () => {
  it("uses TD 2025/4 Tables 1–3 Melbourne capital-city amounts, not Table 5 truck meals", () => {
    const caps = suite.mealCapsForYear("2025-26", 80000);
    expect(caps.determination).toBe("TD 2025/4");
    expect(caps.breakfast).toBe(34.75);
    expect(caps.lunch).toBe(39.1);
    expect(caps.dinner).toBe(66.65);
    expect(caps.mealsDaily).toBe(140.5);
    expect(caps.incidentals).toBe(24.5);
    expect(caps.accommodation).toBe(173);
    expect(caps.mealsAndIncidentals).toBe(165);
    expect(caps.dailyTravelTotal).toBe(338);
    expect(caps.overtimeMealCap).toBe(38.65);
    expect(caps.representativePlace).toBe("Melbourne");
  });

  it("raises band-2 and band-3 capital-city stacks", () => {
    const b2 = suite.mealCapsForYear("2025-26", 200000);
    expect(b2.salaryBand).toBe("band2");
    expect(b2.mealsDaily).toBe(166.3);
    expect(b2.dailyTravelTotal).toBe(432.35);
    const b3 = suite.mealCapsForYear("2025-26", 300000);
    expect(b3.salaryBand).toBe("band3");
    expect(b3.mealsDaily).toBe(185.15);
    expect(b3.dailyTravelTotal).toBe(485.2);
  });

  it("uses TD 2026/4 Melbourne Table 1 for 2026-27", () => {
    const caps = suite.mealCapsForYear("2026-27", 90000);
    expect(caps.determination).toBe("TD 2026/4");
    expect(caps.breakfast).toBe(36);
    expect(caps.lunch).toBe(40.45);
    expect(caps.dinner).toBe(69);
    expect(caps.accommodation).toBe(175);
    expect(caps.incidentals).toBe(25.4);
    expect(caps.dailyTravelTotal).toBe(345.85);
  });

  it("estimates work travel nights from meals + incidentals, not the $128 truck rate", () => {
    const records = {
      income: [
        {
          id: "i1",
          date: "2025-08-10",
          type: "allowance_travel",
          description: "Travel allowance",
          amount: 330,
          travelAllowanceAmount: 330,
        },
      ],
    };
    const snap = suite.summariseOvernightDays(
      records,
      { financialYear: "2025-26", annualSalary: 80000, entityType: "employee" },
      "2025-26"
    );
    expect(snap.travelKind).toBe("ordinary_employee");
    expect(snap.title).toBe("Work travel nights");
    expect(snap.ratePerDay).toBe(165);
    expect(snap.daysClaimed).toBe(2);
    expect(snap.note).toMatch(/Tables 1–3/);
    expect(snap.note).not.toMatch(/truck-driver meal rate/i);
    expect(snap.note).toMatch(/TD 2025\/2/);
    expect(snap.note).toMatch(/\$341\/week/);
  });

  it("summarises FBT LAFHA as a weekly food component, not truck daily meals", () => {
    const s = suite.summariseLafha(
      { annualSalary: 85000, entityType: "employee" },
      [],
      "2025-26"
    );
    expect(s.determination).toBe("TD 2025/2");
    expect(s.reasonablePerWeek).toBe(341);
    expect(s.statutoryFoodPerWeek).toBe(42);
    expect(s.unsubstantiatedExemptPerWeek).toBe(299);
    expect(s.reasonablePerDay).toBeNull();
    expect(s.note).toMatch(/sales and marketing/i);
    expect(s.note).not.toMatch(/Table 5/);
    expect(s.workTravelDaily.dailyTotal).toBe(338);
  });

  it("uses TD 2026/2 one-adult weekly food for 2026-27", () => {
    expect(suite.lafhaWeeklyForYear("2026-27").oneAdult).toBe(353);
    expect(suite.lafhaWeeklyForYear("2026-27").determination).toBe("TD 2026/2");
  });
});

describe("suite product detection", () => {
  const prevProduct = process.env.APP_PRODUCT;
  const prevStandalone = process.env.GOTAX_STANDALONE;

  afterEach(() => {
    if (prevProduct === undefined) delete process.env.APP_PRODUCT;
    else process.env.APP_PRODUCT = prevProduct;
    if (prevStandalone === undefined) delete process.env.GOTAX_STANDALONE;
    else process.env.GOTAX_STANDALONE = prevStandalone;
  });

  it("detects the suite cookie and /suite referer", () => {
    delete process.env.APP_PRODUCT;
    delete process.env.GOTAX_STANDALONE;
    expect(suite.productOf({ headers: { cookie: "gotax_product=1" } })).toBe("suite");
    expect(suite.productOf({ headers: { referer: "http://localhost:3000/suite/" } })).toBe("suite");
    expect(suite.productOf({ headers: { cookie: "" } })).toBe("haulage");
    expect(suite.publicHomePath()).toBe("/haulage/");
    expect(suite.recoveryPagePath({ headers: { cookie: "" } })).toBe("/haulage/recover.html");
    expect(suite.recoveryPagePath({ headers: { cookie: "gotax_product=1" } })).toBe(
      "/suite/recover.html"
    );
  });

  it("treats APP_PRODUCT=suite as a dedicated Render host", () => {
    process.env.APP_PRODUCT = "suite";
    delete process.env.GOTAX_STANDALONE;
    expect(suite.isStandaloneSuite()).toBe(true);
    expect(suite.productOf({ headers: { cookie: "" } })).toBe("suite");
    expect(suite.publicHomePath()).toBe("/suite/");
    expect(suite.recoveryPagePath({ headers: {} })).toBe("/suite/recover.html");
  });

  it("treats GOTAX_STANDALONE=1 as a dedicated Render host", () => {
    delete process.env.APP_PRODUCT;
    process.env.GOTAX_STANDALONE = "1";
    expect(suite.isStandaloneSuite()).toBe(true);
    expect(suite.productOf(null)).toBe("suite");
  });

  it("does not switch Driver Hub when APP_PRODUCT=haulage", () => {
    process.env.APP_PRODUCT = "haulage";
    process.env.GOTAX_STANDALONE = "1";
    expect(suite.isStandaloneSuite()).toBe(false);
    expect(suite.productOf({ headers: { cookie: "" } })).toBe("haulage");
  });
});
