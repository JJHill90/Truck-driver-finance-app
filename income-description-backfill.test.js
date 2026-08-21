const { backfillIncomeDescriptions } = require("./lib/income-description-backfill");

describe("backfillIncomeDescriptions", () => {
  it("rewrites Payslip clutter using receipt OCR company + pay period", () => {
    const records = {
      income: [
        {
          id: "i1",
          date: "2026-06-11",
          receiptId: "r1",
          description: "Payslip",
          entity: "Facsimilie 02 6777 1080",
          summaryNotes: "Entity: Facsimilie · Gross: $3064.52",
        },
      ],
      receipts: [
        {
          id: "r1",
          linkedIncomeId: "i1",
          ocrResult: {
            rawText: `
Payment Date: 11/6/2026
Pay Period From: 3/6/2026 To: 9/6/2026
Email: admin@bettstransport.com.au
ABN: 60 003 894 568
Facsimilie 02 6777 1080
`,
            date: "2026-06-11",
          },
        },
      ],
    };

    const result = backfillIncomeDescriptions(records);
    expect(result.updated).toBe(1);
    expect(records.income[0].description).toBe(
      "Betts Transport, pay period 03/06/2026 to 09/06/2026"
    );
    expect(records.income[0].entity).toBe("Betts Transport");
  });

  it("skips descriptions that already look like company + pay period", () => {
    const records = {
      income: [
        {
          id: "i2",
          date: "2026-06-11",
          description: "Betts Transport, pay period 03/06/2026 to 09/06/2026",
          entity: "Betts Transport",
        },
      ],
      receipts: [],
    };
    expect(backfillIncomeDescriptions(records).updated).toBe(0);
  });
});
