const { slimOcrResultForClient, presentScanJson, RAW_TEXT_CLIENT_MAX } = require("./lib/scan-ocr-present");
const { mergeRasterIntoOcr, rasterOptionsFor, shouldRasterPdf } = require("./lib/pdf-ocr");

describe("slimOcrResultForClient", () => {
  it("caps rawText so Android does not parse a full payslip dump", () => {
    const rawText = "PAYSLIP ".repeat(2000);
    const slim = slimOcrResultForClient({
      amount: 1200,
      rawText,
      rawTextPreview: rawText,
      lineItems: Array.from({ length: 80 }, (_, i) => ({ label: `row ${i}`, amount: i + 1 })),
      candidateAmounts: Array.from({ length: 40 }, (_, i) => i + 1),
    });
    expect(slim.rawText.length).toBe(RAW_TEXT_CLIENT_MAX);
    expect(slim.rawTextPreview.length).toBe(RAW_TEXT_CLIENT_MAX);
    expect(slim.lineItems).toHaveLength(40);
    expect(slim.candidateAmounts).toHaveLength(24);
    expect(slim.amount).toBe(1200);
  });

  it("leaves small results alone", () => {
    const ocr = { amount: 50, rawText: "TOTAL 50.00", vendor: "BP" };
    expect(slimOcrResultForClient(ocr)).toMatchObject(ocr);
  });
});

describe("presentScanJson", () => {
  it("slims ocrResult on a scan payload and keeps receipt meta", () => {
    const rawText = "x".repeat(5000);
    const out = presentScanJson({
      receipt: { id: "r1" },
      ocrResult: { rawText, amount: 10 },
      ocrPending: true,
    });
    expect(out.receipt.id).toBe("r1");
    expect(out.ocrPending).toBe(true);
    expect(out.ocrResult.rawText.length).toBe(RAW_TEXT_CLIENT_MAX);
    expect(out.ocrResult.amount).toBe(10);
  });
});

describe("mergeRasterIntoOcr", () => {
  it("prefers raster totals and clears ocrPending", () => {
    const merged = mergeRasterIntoOcr(
      { amount: null, vendor: "", ocrPending: true, ocrSource: "pdf" },
      { amount: 2431, netPay: 2431, vendor: "Betts Transport", ocrSource: "pdf-raster-ocr" },
      "income"
    );
    expect(merged.amount).toBe(2431);
    expect(merged.netPay).toBe(2431);
    expect(merged.entity).toBe("Betts Transport");
    expect(merged.ocrPending).toBe(false);
    expect(merged.ocrSource).toContain("pdf-raster-ocr");
    expect(merged.documentType).toBe("income");
  });
});

describe("rasterOptionsFor", () => {
  it("keeps income raster to one lighter page", () => {
    const income = rasterOptionsFor("income");
    expect(income.maxPages).toBe(1);
    expect(income.zoom).toBeLessThan(2);
    expect(income.timeoutMs).toBeLessThanOrEqual(15000);
  });
});

describe("shouldRasterPdf (deferred path still only for image PDFs)", () => {
  it("does not defer digital payslips with a usable text layer", () => {
    const text = `BETTS TRANSPORT PAYSLIP
Pay period 03/06/2026 to 09/06/2026
Employee A DRIVER ordinary time overtime travel
See attached breakdown for this payment`;
    expect(shouldRasterPdf({ amount: null, grossTotal: null }, "income", text)).toBe(false);
  });
});
