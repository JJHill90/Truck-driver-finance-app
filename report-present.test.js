const {
  presentExpenseLabel,
  presentIncomeTypeLabel,
  assessableIncomeAmount,
  recordsForAccountantReport,
  presentLafhaDays,
  decorateReportPresentation,
} = require("./lib/report-present");
const { buildAccountantReport } = require("./lib/tax-calculator");
const { applyHistoricalRates } = require("./lib/historical-rates");

describe("report presentation — categories, totals, LAFHA days", () => {
  it("uses Taxation Hub menu labels for expense and income types", () => {
    expect(presentExpenseLabel("compulsory_assessment")).toBe("Medical equipment");
    expect(presentExpenseLabel("meals")).toBe("Food/Meals (Daily)");
    expect(presentExpenseLabel("meals_breakfast")).toBe("Breakfast");
    expect(presentExpenseLabel("office_admin")).toMatch(/Logbook|Work Diary/i);
    expect(presentIncomeTypeLabel("allowance_travel")).toBe(
      "Living Away from Home / Travel allowance"
    );
    expect(presentIncomeTypeLabel("salary_wages")).toMatch(/salary|wage/i);
  });

  it("prefers taxable/gross over net-pay amount for assessable totals", () => {
    expect(
      assessableIncomeAmount({
        amount: 1800,
        netPay: 1800,
        grossTotal: 2500,
        taxableIncome: 2500,
      })
    ).toBe(2500);
    expect(assessableIncomeAmount({ amount: 900, grossTotal: 0, taxableIncome: 0 })).toBe(900);
  });

  it("rebuilds accountant income totals from taxable/gross bases", () => {
    const records = {
      profile: { financialYear: "2025-26", annualSalary: 90000, driverType: "long_haul" },
      expenses: [
        {
          id: "e1",
          date: "2025-08-10",
          category: "compulsory_assessment",
          amount: 120,
          workUsePercent: 100,
        },
        {
          id: "e2",
          date: "2025-08-11",
          category: "meals_breakfast",
          amount: 25,
          workUsePercent: 100,
        },
      ],
      income: [
        {
          id: "i1",
          date: "2025-08-12",
          type: "salary_wages",
          amount: 1800,
          netPay: 1800,
          grossTotal: 2500,
          taxableIncome: 2500,
        },
        {
          id: "i2",
          date: "2025-08-13",
          type: "allowance_travel",
          amount: 400,
          grossTotal: 400,
          taxableIncome: 400,
          claimingDeduction: true,
          overnightDays: 5,
        },
      ],
    };

    const reportRecords = recordsForAccountantReport(records);
    const report = buildAccountantReport(reportRecords, {
      ...records.profile,
      financialYear: "2025-26",
    });
    applyHistoricalRates(report.summary, reportRecords, "2025-26");
    report.atoScheduleMapping = report.summary.expenses.breakdown.map((b) => ({
      schedule: b.atoSchedule,
      category: b.label,
      deductibleAmount: b.deductibleTotal,
      transactionCount: b.count,
    }));
    decorateReportPresentation(report, records, "2025-26");

    expect(report.summary.income.grossTotal).toBe(2900);
    expect(report.summary.income.assessableTotal).toBe(2900);
    const salary = report.summary.income.breakdown.find((b) => /salary/i.test(b.label));
    expect(salary.grossTotal).toBe(2500);
    const travel = report.summary.income.breakdown.find((b) => /Living Away|Travel/i.test(b.label));
    expect(travel).toBeTruthy();
    expect(travel.label).toBe("Living Away from Home / Travel allowance");

    const medical = report.summary.expenses.breakdown.find((b) => /Medical equipment/i.test(b.label));
    expect(medical).toBeTruthy();
    const breakfast = report.summary.expenses.breakdown.find((b) => b.label === "Breakfast");
    expect(breakfast).toBeTruthy();
    expect(report.summary.expenses.deductibleTotal).toBe(145);

    expect(report.lafhaDays).toBeTruthy();
    expect(report.lafhaDays.daysClaimed).toBe(5);
    expect(report.lafhaDays.amountPaid).toBeUndefined();
    expect(report.lafhaDays.entries[0].amount).toBeUndefined();
    expect(report.lafhaDays.entries[0].days).toBe(5);
  });

  it("presentLafhaDays omits dollar fields", () => {
    const days = presentLafhaDays(
      {
        income: [
          {
            id: "x",
            date: "2025-09-01",
            type: "allowance_travel",
            amount: 640,
            overnightDays: 5,
            description: "Travel",
          },
        ],
        profile: { financialYear: "2025-26" },
      },
      { financialYear: "2025-26" },
      "2025-26"
    );
    expect(days.daysClaimed).toBe(5);
    expect(days).not.toHaveProperty("amountPaid");
    expect(JSON.stringify(days)).not.toMatch(/amountPaid|"amount":/);
  });
});
