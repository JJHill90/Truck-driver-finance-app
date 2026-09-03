const {
  extractTaxWithheld,
  taxWithheldFromText,
  taxWithheldFromBreakdown,
  attachIncomeTaxWithheld,
  payslipTaxVisualFromRecords,
} = require("./lib/income-tax-withheld");

describe("taxWithheldFromText", () => {
  it("reads PAYG Withholding from a Betts-style remittance line", () => {
    const text = `
      GROSS PAY $2,966.50
      PAYG Withholding -$738.00
      NET PAY $2,228.50
    `;
    expect(taxWithheldFromText(text)).toBe(738);
  });

  it("reads Income tax withheld wording", () => {
    expect(taxWithheldFromText("Income tax withheld $412.50")).toBe(412.5);
  });
});

describe("extractTaxWithheld", () => {
  it("prefers explicit ocrResult.taxWithheld", () => {
    expect(
      extractTaxWithheld({ taxWithheld: 100, rawText: "PAYG Withholding -$738.00" })
    ).toBe(100);
  });

  it("falls back to breakdown tax component then raw text", () => {
    expect(
      extractTaxWithheld(
        { rawText: "PAYG Withholding -$50.00" },
        [{ type: "tax", label: "PAYG tax withheld", amount: 400 }]
      )
    ).toBe(400);
    expect(extractTaxWithheld({ rawText: "PAYG Withholding -$50.00" })).toBe(50);
  });
});

describe("taxWithheldFromBreakdown", () => {
  it("sums tax-typed components", () => {
    expect(
      taxWithheldFromBreakdown([
        { type: "wages", amount: 2966.5 },
        { type: "tax", label: "PAYG tax withheld", amount: 738 },
      ])
    ).toBe(738);
  });
});

describe("attachIncomeTaxWithheld", () => {
  it("stores taxWithheld on the income entry from payload", () => {
    const entry = { id: "i1", amount: 2228.5, grossTotal: 2966.5 };
    attachIncomeTaxWithheld(entry, { taxWithheld: 738 }, null);
    expect(entry.taxWithheld).toBe(738);
  });

  it("backfills from linked receipt OCR when payload has no tax", () => {
    const entry = { id: "i2", amount: 2228.5, grossTotal: 2966.5 };
    attachIncomeTaxWithheld(entry, {}, {
      ocrResult: { rawText: "PAYG Withholding -$738.00", grossTotal: 2966.5 },
    });
    expect(entry.taxWithheld).toBe(738);
  });
});

describe("payslipTaxVisualFromRecords", () => {
  it("totals gross and PAYG for the FY (visual only)", () => {
    const records = {
      income: [
        {
          id: "a",
          date: "2026-09-03",
          grossTotal: 2966.5,
          amount: 2228.5,
          taxWithheld: 738,
        },
        {
          id: "b",
          date: "2025-01-01",
          grossTotal: 1000,
          amount: 800,
          taxWithheld: 200,
        },
      ],
      receipts: [],
    };
    const visual = payslipTaxVisualFromRecords(records, "2026-27", {
      getFinancialYearForDate: (d) => (String(d).startsWith("2026") ? "2026-27" : "2024-25"),
    });
    expect(visual.grossIncome).toBe(2966.5);
    expect(visual.incomeTax).toBe(738);
    expect(visual.taxOfGrossPct).toBe(24.9);
    expect(visual.entryCount).toBe(1);
  });

  it("backfills tax from receipt OCR when the ledger row lacks taxWithheld", () => {
    const records = {
      income: [
        {
          id: "c",
          date: "2026-09-03",
          grossTotal: 2966.5,
          amount: 2228.5,
          receiptId: "r1",
        },
      ],
      receipts: [
        {
          id: "r1",
          ocrResult: { rawText: "GROSS PAY $2,966.50\nPAYG Withholding -$738.00" },
        },
      ],
    };
    const visual = payslipTaxVisualFromRecords(records, null);
    expect(visual.grossIncome).toBe(2966.5);
    expect(visual.incomeTax).toBe(738);
  });
});
