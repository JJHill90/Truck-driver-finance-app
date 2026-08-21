const { backfillOvernightDays } = require("./lib/overnight-days-backfill");

describe("backfillOvernightDays", () => {
  it("fills overnight days from linked receipt OCR (Betts-style hours)", () => {
    const records = {
      income: [
        {
          id: "inc1",
          date: "2026-06-11",
          receiptId: "rec1",
          type: "salary_wages",
          amount: 2281.5,
          grossTotal: 3064.52,
          description: "Payslip",
        },
      ],
      receipts: [
        {
          id: "rec1",
          linkedIncomeId: "inc1",
          purpose: "income",
          ocrResult: {
            rawText: `
Travel Allowance 7.00 $56.28 $393.96 $16,715.16 Wages
GROSS PAY: $3,064.52
NET PAY: $2,281.50
`,
            date: "2026-06-11",
          },
        },
      ],
    };

    const result = backfillOvernightDays(records);
    expect(result.updated).toBe(1);
    expect(records.income[0].overnightDays).toBe(7);
    expect(records.income[0].travelAllowanceAmount).toBe(393.96);
    expect(String(records.income[0].overnightDaysSource)).toMatch(/^backfill_/);
  });

  it("repairs hours mistaken for dollar amount", () => {
    const records = {
      income: [
        {
          id: "inc2",
          date: "2026-06-11",
          receiptId: "rec2",
          travelAllowanceAmount: 7,
          overnightDays: 0,
          overnightDaysSource: "amount_div_rate",
        },
      ],
      receipts: [
        {
          id: "rec2",
          ocrResult: {
            rawText: "Travel Allowance 7.00 $56.28 $393.96 $16,715.16 Wages",
            date: "2026-06-11",
          },
        },
      ],
    };

    const result = backfillOvernightDays(records);
    expect(result.updated).toBe(1);
    expect(records.income[0].overnightDays).toBe(7);
    expect(records.income[0].travelAllowanceAmount).toBe(393.96);
  });

  it("skips rows that already have overnight days", () => {
    const records = {
      income: [{ id: "inc3", date: "2026-06-11", overnightDays: 5, travelAllowanceAmount: 640 }],
      receipts: [],
    };
    expect(backfillOvernightDays(records).updated).toBe(0);
  });
});
