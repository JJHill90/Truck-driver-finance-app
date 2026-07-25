const { buildIncomeSummaryFromText } = require("./lib/income-document-ocr");
const {
  extractMoneyFromText,
  buildExpenseSummaryFromText,
} = require("./lib/local-receipt-ocr");
const { mergeDetectedTotals, normalizeOcrResult } = require("./lib/receipt-ocr");

describe("extractMoneyFromText", () => {
  it("reads 5+ digit amounts with cents", () => {
    const parsed = extractMoneyFromText("Gross Pay 12345.67\nNet Pay 9800.00");
    expect(parsed.candidateAmounts).toContain(12345.67);
    expect(parsed.candidateAmounts).toContain(9800);
  });

  it("does not treat dates or ABN digit groups as the receipt total", () => {
    const parsed = extractMoneyFromText(`BP TRUCK STOP
ABN 12 345 678 901
Date 24/07/2026
Diesel 150.00
TOTAL 187.50
GST 17.05
`);
    expect(parsed.amount).toBe(187.5);
    expect(parsed.gst).toBe(17.05);
    expect(parsed.candidateAmounts).not.toContain(2026);
    expect(parsed.candidateAmounts).not.toContain(901);
    expect(parsed.candidateAmounts).toContain(187.5);
  });

  it("reads expense invoice totals from labeled lines", () => {
    const summary = buildExpenseSummaryFromText(`TAX INVOICE
Subtotal 100.00
GST 10.00
Amount Due 110.00
`);
    expect(summary.amount).toBe(110);
    expect(summary.gst).toBe(10);
    expect(summary.documentType).toBe("expense");
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
