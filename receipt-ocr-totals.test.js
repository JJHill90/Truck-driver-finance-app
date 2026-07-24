const { mergeDetectedTotals, getDetectedTotals } = require("./lib/receipt-ocr");

describe("mergeDetectedTotals (expense)", () => {
  it("picks the labeled grand total when multiple line amounts exist", () => {
    const ocr = {
      documentType: "expense",
      amount: 187.5,
      gst: 17.05,
      lineItems: [
        { description: "Diesel", amount: 150 },
        { description: "AdBlue", amount: 20.45 },
        { description: "Coffee", amount: 4.5 },
      ],
      candidateAmounts: [150, 20.45, 4.5, 17.05, 187.5],
    };
    const components = [
      { label: "Diesel", amount: 150, detected: true },
      { label: "AdBlue", amount: 20.45, detected: true },
      { label: "Coffee", amount: 4.5, detected: true },
      { label: "GST", amount: 17.05, detected: true },
      { label: "Grand total", amount: 187.5, detected: true },
    ];
    const totals = mergeDetectedTotals(ocr, components, "expense");
    const primary = totals.find((t) => t.primary);
    expect(primary.amount).toBe(187.5);
    expect(primary.label).toMatch(/total/i);
    expect(totals.filter((t) => t.primary)).toHaveLength(1);
  });

  it("falls back to the largest amount when no overall-total label exists", () => {
    const ocr = {
      documentType: "expense",
      amount: null,
      lineItems: [
        { description: "Item A", amount: 45 },
        { description: "Item B", amount: 120.25 },
        { description: "Item C", amount: 12 },
      ],
      candidateAmounts: [45, 120.25, 12],
    };
    const totals = mergeDetectedTotals(ocr, [], "expense");
    const primary = totals.find((t) => t.primary);
    expect(primary.amount).toBe(120.25);
    expect(totals.filter((t) => t.primary)).toHaveLength(1);
  });

  it("prefers Total Due over a larger unrelated candidate when labeled", () => {
    const ocr = {
      documentType: "expense",
      amount: 88,
      lineItems: [{ description: "Total Due", amount: 88 }],
      candidateAmounts: [500, 88, 8],
    };
    const components = [
      { label: "Total Due", amount: 88, detected: true },
      { label: "Points balance", amount: 500, detected: true },
    ];
    const totals = mergeDetectedTotals(ocr, components, "expense");
    const primary = totals.find((t) => t.primary);
    expect(primary.amount).toBe(88);
    expect(primary.label).toMatch(/total/i);
  });
});

describe("mergeDetectedTotals (income)", () => {
  it("keeps gross as primary among payslip fields", () => {
    const ocr = {
      documentType: "income",
      amount: 1500,
      grossTotal: 2000,
      taxableIncome: 1900,
      netPay: 1500,
    };
    const totals = mergeDetectedTotals(ocr, [], "income");
    const primary = totals.find((t) => t.primary);
    expect(primary.amount).toBe(2000);
    expect(totals.filter((t) => t.primary)).toHaveLength(1);
  });
});

describe("getDetectedTotals", () => {
  it("marks grand total primary for expense OCR", () => {
    const totals = getDetectedTotals({
      documentType: "expense",
      amount: 42.5,
      gst: 3.86,
    });
    expect(totals.find((t) => t.primary).amount).toBe(42.5);
  });
});
