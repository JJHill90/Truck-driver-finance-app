const { summariseOvernightDays, overnightDaysForEntry } = require("./lib/overnight-days");

describe("overnightDaysForEntry", () => {
  it("uses stored overnightDays first", () => {
    const hit = overnightDaysForEntry(
      { overnightDays: 5, travelAllowanceAmount: 640, overnightDaysSource: "payslip_days" },
      128
    );
    expect(hit).toEqual({ days: 5, amount: 640, source: "payslip_days" });
  });

  it("estimates from travelAllowanceAmount ÷ rate", () => {
    const hit = overnightDaysForEntry({ travelAllowanceAmount: 640 }, 128);
    expect(hit.days).toBe(5);
    expect(hit.source).toBe("travel_amount");
  });
});

describe("summariseOvernightDays", () => {
  it("sums claimed nights vs FY length", () => {
    const summary = summariseOvernightDays(
      {
        income: [
          {
            id: "a",
            date: "2025-08-01",
            overnightDays: 4,
            travelAllowanceAmount: 512,
            description: "Week 1",
          },
          {
            id: "b",
            date: "2025-08-15",
            overnightDays: 3,
            travelAllowanceAmount: 384,
            description: "Week 2",
          },
          {
            id: "c",
            date: "2024-08-01",
            overnightDays: 10,
            description: "Prior FY",
          },
        ],
      },
      { financialYear: "2025-26" },
      "2025-26"
    );

    expect(summary.financialYear).toBe("2025-26");
    expect(summary.daysClaimed).toBe(7);
    expect(summary.entryCount).toBe(2);
    expect(summary.daysInFy).toBeGreaterThan(300);
    expect(summary.daysRemainingInFy).toBe(summary.daysInFy - 7);
    expect(summary.amountPaid).toBe(896);
    expect(summary.projectedYearEndDays).toBeGreaterThanOrEqual(7);
  });

  it("estimates dedicated allowance_travel rows from amount ÷ meal rate", () => {
    const summary = summariseOvernightDays(
      {
        income: [
          {
            id: "lafha",
            date: "2025-10-01",
            type: "allowance_travel",
            amount: 640,
            grossTotal: 640,
            description: "Living Away from Home / Travel allowance",
          },
        ],
      },
      {},
      "2025-26"
    );
    expect(summary.daysClaimed).toBeGreaterThan(0);
    expect(summary.entryCount).toBe(1);
  });

  it("does not treat salary payslips as full-gross travel from description alone", () => {
    const summary = summariseOvernightDays(
      {
        income: [
          {
            id: "pay",
            date: "2025-10-01",
            type: "salary_wages",
            amount: 1900,
            grossTotal: 2540,
            description: "Week 1 Travel Allowance mentioned",
          },
        ],
      },
      {},
      "2025-26"
    );
    expect(summary.daysClaimed).toBe(0);
    expect(summary.entryCount).toBe(0);
  });
});
