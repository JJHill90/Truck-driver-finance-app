const {
  isNetLabel,
  isExcludedFromPrimary,
  extractLabeledNetFromText,
  pickBestIncomePrimary,
  refineIncomeDetectedTotals,
  applyIncomePrimaryToOcr,
} = require("./lib/income-total");
const { mergeDetectedTotals } = require("./lib/receipt-ocr");

describe("income-total net priority", () => {
  it("detects net income / net pay labels", () => {
    expect(isNetLabel("Net pay")).toBe(true);
    expect(isNetLabel("Net income")).toBe(true);
    expect(isNetLabel("Take home pay")).toBe(true);
    expect(isNetLabel("Gross total")).toBe(false);
    expect(isNetLabel("GST")).toBe(false);
  });

  it("excludes GST / PAYG / YTD from largest-amount fallback", () => {
    expect(isExcludedFromPrimary("GST")).toBe(true);
    expect(isExcludedFromPrimary("PAYG tax")).toBe(true);
    expect(isExcludedFromPrimary("YTD gross")).toBe(true);
    expect(isExcludedFromPrimary("Gross total")).toBe(false);
  });

  it("extracts net income from raw text", () => {
    const hit = extractLabeledNetFromText(
      "Gross pay $2,000.00\nNet income $1,650.00\nGST $150.00"
    );
    expect(hit).toEqual({ label: "Net income", amount: 1650, source: "rawText" });
  });

  it("prefers net pay over gross as primary after merge", () => {
    const ocr = {
      documentType: "income",
      grossTotal: 2500.5,
      netPay: 1980.25,
      taxableIncome: 2500.5,
      gstAmount: 0,
    };
    const merged = mergeDetectedTotals(ocr, [], "income");
    // Verbatim merge prefers gross — refine must flip to net.
    expect(merged.find((t) => t.primary)?.label).toMatch(/gross/i);

    const refined = refineIncomeDetectedTotals(merged, ocr);
    const primary = refined.find((t) => t.primary);
    expect(primary.amount).toBe(1980.25);
    expect(isNetLabel(primary.label)).toBe(true);
  });

  it("still prefers integer net pays in the 1900–2100 range", () => {
    const refined = refineIncomeDetectedTotals(
      [
        { label: "Gross total", amount: 2500, primary: true },
        { label: "Net pay", amount: 1980, primary: false },
      ],
      { netPay: 1980 }
    );
    expect(refined.find((t) => t.primary).amount).toBe(1980);
  });

  it("prefers net income label even when gross is larger", () => {
    const totals = [
      { label: "Gross total", amount: 3200, primary: true },
      { label: "Net income", amount: 2750, primary: false },
      { label: "GST", amount: 250, primary: false },
    ];
    const refined = refineIncomeDetectedTotals(totals, {});
    expect(refined.find((t) => t.primary)).toMatchObject({
      label: "Net income",
      amount: 2750,
    });
  });

  it("falls back to largest amount when no net wording exists", () => {
    const totals = [
      { label: "Gross total", amount: 1800, primary: true },
      { label: "Taxable income", amount: 1800, primary: false },
      { label: "GST", amount: 163.64, primary: false },
      { label: "Detected $42.00", amount: 42, primary: false },
    ];
    const refined = refineIncomeDetectedTotals(totals, { documentType: "income" });
    const primary = refined.find((t) => t.primary);
    expect(primary.amount).toBe(1800);
    expect(primary.label).not.toMatch(/gst/i);
  });

  it("uses raw-text net when structured netPay is missing", () => {
    const ocr = {
      documentType: "income",
      grossTotal: 4000,
      rawText: "Remittance advice\nGross $4,000.00\nNet pay $3,100.50\n",
    };
    const merged = mergeDetectedTotals(ocr, [], "income");
    const refined = refineIncomeDetectedTotals(merged, ocr);
    expect(refined.find((t) => t.primary).amount).toBe(3100.5);
  });

  it("syncs OCR amount/netPay to the net primary without wiping gross", () => {
    const ocr = { grossTotal: 2500, netPay: null, amount: 2500 };
    applyIncomePrimaryToOcr(ocr, { label: "Net pay", amount: 1980 });
    expect(ocr.grossTotal).toBe(2500);
    expect(ocr.netPay).toBe(1980);
    expect(ocr.amount).toBe(1980);
  });

  it("pickBestIncomePrimary reports reason", () => {
    expect(
      pickBestIncomePrimary(
        [
          { label: "Gross", amount: 1000 },
          { label: "Net pay", amount: 800 },
        ],
        {}
      )
    ).toMatchObject({ reason: "net_label", amount: 800 });

    expect(
      pickBestIncomePrimary(
        [
          { label: "Gross total", amount: 1000 },
          { label: "GST", amount: 90 },
        ],
        {}
      )
    ).toMatchObject({ reason: "largest", amount: 1000 });
  });
});
