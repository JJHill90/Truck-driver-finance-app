const { buildIncomeSummaryFromText } = require("./lib/income-document-ocr");
const { extractMoneyFromText } = require("./lib/local-receipt-ocr");
const { mergeDetectedTotals, normalizeOcrResult } = require("./lib/receipt-ocr");

describe("extractMoneyFromText", () => {
  it("reads 5+ digit amounts without thousands separators", () => {
    const parsed = extractMoneyFromText("Gross Pay 12345.67\nNet Pay 9800.00");
    expect(parsed.candidateAmounts).toContain(12345.67);
    expect(parsed.candidateAmounts).toContain(9800);
  });
});

describe("buildIncomeSummaryFromText", () => {
  it("extracts gross/net from a spaced payslip layout", () => {
    const text = `BETTS TRANSPORT
PAYSLIP
Pay period 01/07/2026 to 14/07/2026
Gross Pay

4523.45
PAYG Tax Withheld 890.00
Net Pay 3633.45
`;
    const summary = buildIncomeSummaryFromText(text, "income");
    expect(summary.grossTotal).toBe(4523.45);
    expect(summary.netPay).toBe(3633.45);
    expect(summary.amount).toBe(3633.45);
    expect(summary.gstAmount).toBeNull();
    expect(summary.rawText).toContain("Gross Pay");
  });

  it("falls back to the largest candidate when labels are weak", () => {
    const text = `Payment advice
Period total 2750.50
Other 12.00
`;
    const summary = buildIncomeSummaryFromText(text, "income");
    expect(summary.grossTotal).toBe(2750.5);
    expect(summary.amount).toBe(2750.5);
  });
});

describe("mergeDetectedTotals income", () => {
  it("marks gross/wages as primary even when other amounts appear first", () => {
    const ocr = normalizeOcrResult({
      documentType: "income",
      amount: 1850,
      grossTotal: 2200,
      netPay: 1850,
      taxableIncome: 2200,
    });
    const components = [
      { label: "PAYG tax withheld", amount: 350, detected: true },
      { label: "Wages / gross pay", amount: 2200, detected: true },
      { label: "Net pay", amount: 1850, detected: true },
    ];
    const totals = mergeDetectedTotals(ocr, components, "income");
    const primary = totals.find((t) => t.primary);
    expect(primary.amount).toBe(2200);
    expect(primary.label).toMatch(/gross|wages/i);
  });
});
