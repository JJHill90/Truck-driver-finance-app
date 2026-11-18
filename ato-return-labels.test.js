const { calcExpenseDeduction, summariseYear, buildAccountantReport } = require("./lib/tax-calculator");
const suite = require("./lib/suite/tax");
const {
  mapExpenseSchedule,
  mapIncomeItem,
  stampReport,
  rollupAtoReturn,
  applyAtoReturnLabels,
} = require("./lib/ato-return-labels");
const { deductionBucket, mapIncomeItem: packIncome } = require("./lib/accountant-pack");

describe("individual return labels", () => {
  it("maps overnight travel to D2 and overtime meals to D5", () => {
    expect(mapExpenseSchedule("meals_breakfast", "D5 – Travel").label).toBe(
      "D2 Work-related travel expenses"
    );
    expect(mapExpenseSchedule("accommodation", "D5 – Travel").code).toBe("D2");
    expect(mapExpenseSchedule("incidentals", "D5 – Other work-related expenses / travel").code).toBe(
      "D2"
    );
    expect(mapExpenseSchedule("overtime_meals", "D5 – Other work-related").label).toBe(
      "D5 Other work-related expenses"
    );
  });

  it("maps car parking to D1 and keeps truck running costs on D2", () => {
    expect(mapExpenseSchedule("parking_tolls", "D1 or D2").label).toBe(
      "D1 Work-related car expenses"
    );
    expect(mapExpenseSchedule("vehicle_car", "D1 – Work-related car expenses").code).toBe("D1");
    expect(mapExpenseSchedule("fuel", "D2 – Work-related travel expenses").code).toBe("D2");
    expect(mapExpenseSchedule("fuel", "D1 – Work-related car expenses", { product: "suite" }).code).toBe(
      "D1"
    );
  });

  it("uses the other official deduction boxes and business-schedule lines", () => {
    expect(mapExpenseSchedule("donations_dgr", "D9 – Gifts or donations").code).toBe("D9");
    expect(mapExpenseSchedule("tax_affairs", "D10 – Cost of managing tax affairs").code).toBe("D10");
    expect(mapExpenseSchedule("super_personal", "Personal superannuation contribution").code).toBe(
      "D12"
    );
    expect(mapExpenseSchedule("income_protection", "D5 – Other work-related").code).toBe("D15");
    expect(mapExpenseSchedule("home_office_hours", "D5 – Working from home (PCG 2023/1)").code).toBe(
      "D5"
    );
    expect(
      mapExpenseSchedule("home_office_hours", "D5 – Working from home (PCG 2023/1)", {
        product: "suite",
        entity: "sole_trader",
      }).label
    ).toBe("Business schedule — all other expenses");
    expect(mapExpenseSchedule("stock_cogs", "Business deduction – trading stock").label).toBe(
      "Business schedule — purchases and other costs"
    );
    expect(mapExpenseSchedule("contractor_payments", "Business deduction – contractors").label).toBe(
      "Business schedule — contractor, sub-contractor and commission expenses"
    );
    expect(mapExpenseSchedule("rent_occupancy", "Business deduction – occupancy").label).toBe(
      "Business schedule — rent expenses"
    );
    expect(
      mapExpenseSchedule("cleaning_supplies", "D5 / business deduction", {
        product: "suite",
        entity: "partnership",
      }).code
    ).toBe("P8");
    expect(mapExpenseSchedule("cleaning_supplies", "D5 – Other work-related").code).toBe("D5");
  });

  it("maps every income type onto one return item", () => {
    expect(mapIncomeItem("salary_wages").label).toBe("Item 1 Salary or wages");
    expect(mapIncomeItem("bonus").item).toBe("1");
    expect(mapIncomeItem("allowance_travel").label).toBe(
      "Item 2 Allowances, earnings, tips, directors fees etc."
    );
    expect(mapIncomeItem("training_allowance").item).toBe("2");
    expect(mapIncomeItem("compensation").item).toBe("2");
    expect(mapIncomeItem("government_payments").item).toBe("5");
    expect(mapIncomeItem("interest").label).toBe("Item 10 Gross interest");
    expect(mapIncomeItem("dividends").item).toBe("11");
    expect(mapIncomeItem("partnership_distribution").label).toBe("Item 13 Partnerships and trusts");
    expect(mapIncomeItem("remittance_owner").item).toBe("P8 / 15");
    expect(mapIncomeItem("business_income").label).toMatch(/item 15 on the return is the net/);
    expect(mapIncomeItem("reimbursement").label).toBe("Not included — reimbursement");
    expect(mapIncomeItem("something_else").item).toBe("24");
    expect(packIncome("business_income").item).toBe("P8 / 15");
    expect(deductionBucket("meals_breakfast", "haulage").id).toBe("D2");
    expect(deductionBucket("parking_tolls", "suite").id).toBe("D1");
    expect(deductionBucket("advertising", "suite", "sole_trader").label).toBe(
      "Business schedule — all other expenses"
    );
  });

  it("stamps the EOFY report and rolls Forecast up to the same labels", () => {
    const records = {
      profile: { financialYear: "2025-26", driverType: "long_haul", annualSalary: 90000 },
      expenses: [
        { id: "e1", date: "2025-08-02", category: "meals_breakfast", amount: 28, description: "Breakfast" },
        { id: "e2", date: "2025-08-02", category: "overtime_meals", amount: 20, description: "OT meal" },
        { id: "e3", date: "2025-08-03", category: "parking_tolls", amount: 15, description: "Toll" },
      ],
      income: [
        { id: "i1", date: "2025-08-04", type: "salary_wages", amount: 2000, description: "Pay" },
        { id: "i2", date: "2025-08-04", type: "allowance_travel", amount: 120, description: "TA", claimingDeduction: true },
        { id: "i3", date: "2025-08-04", type: "reimbursement", amount: 40, description: "Toll back" },
      ],
      receipts: [],
    };
    const breakfast = calcExpenseDeduction(records.expenses[0]);
    expect(breakfast.atoSchedule).toMatch(/D5/);
    const report = buildAccountantReport(records, records.profile);
    stampReport(report, records.profile, "haulage");
    const byCat = Object.fromEntries(report.summary.expenses.breakdown.map((b) => [b.category, b.atoSchedule]));
    expect(byCat.meals_breakfast).toBe("D2 Work-related travel expenses");
    expect(byCat.overtime_meals).toBe("D5 Other work-related expenses");
    expect(byCat.parking_tolls).toBe("D1 Work-related car expenses");
    const incomeLabels = report.summary.income.breakdown.map((b) => b.label);
    expect(incomeLabels).toContain("Item 1 Salary or wages");
    expect(incomeLabels).toContain("Item 2 Allowances, earnings, tips, directors fees etc.");
    expect(incomeLabels).toContain("Not included — reimbursement");
    expect(report.atoScheduleMapping.map((row) => row.schedule)).toEqual(
      expect.arrayContaining(["D2 Work-related travel expenses", "D1 Work-related car expenses"])
    );
    const summary = summariseYear(records, records.profile);
    const forecast = rollupAtoReturn(applyAtoReturnLabels(summary, { product: "haulage", entity: "employee" }));
    expect(forecast.note).toMatch(/does not lodge/);
    expect(forecast.deductions.find((row) => row.code === "D2").deductible).toBeGreaterThan(0);
    expect(forecast.income.find((row) => row.item === "1").assessable).toBe(2000);
    expect(forecast.income.find((row) => row.label.startsWith("Not included")).assessable).toBe(0);
  });

  it("keeps a suite employee home office on D5 and a sole trader on the business schedule", () => {
    const employee = {
      profile: { financialYear: "2025-26", entityType: "employee", annualSalary: 80000 },
      expenses: [{ id: "h1", date: "2025-09-01", category: "home_office_hours", amount: 100, hours: 10 }],
      income: [{ id: "p1", date: "2025-09-01", type: "salary_wages", amount: 3000 }],
      receipts: [],
    };
    const report = suite.decorateAccountantReport(suite.buildAccountantReport(employee, employee.profile));
    report.summary = suite.summariseYear(employee, employee.profile);
    stampReport(report, employee.profile, "suite");
    expect(report.summary.expenses.breakdown[0].atoSchedule).toBe("D5 Other work-related expenses");

    const trader = {
      profile: { financialYear: "2025-26", entityType: "sole_trader", annualSalary: 80000 },
      expenses: [
        { id: "a1", date: "2025-09-01", category: "advertising", amount: 200 },
        { id: "c1", date: "2025-09-02", category: "home_office_actual", amount: 80 },
      ],
      income: [{ id: "b1", date: "2025-09-01", type: "business_income", amount: 5000 }],
      receipts: [],
    };
    const traderReport = suite.decorateAccountantReport(
      suite.buildAccountantReport(trader, trader.profile)
    );
    traderReport.summary = suite.summariseYear(trader, trader.profile);
    stampReport(traderReport, trader.profile, "suite");
    const labels = traderReport.summary.expenses.breakdown.map((b) => b.atoSchedule);
    expect(labels).toContain("Business schedule — all other expenses");
    expect(traderReport.summary.income.breakdown[0].label).toMatch(/Item 15 Business schedule/);
    expect(traderReport.summary.income.breakdown[0].sourceLabel).toBeTruthy();
  });
});
