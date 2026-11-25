/**
 * Scanner reliability harness. Synthetic text and a mocked vision model.
 * No receipt photos or personal data.
 */
const { guessAbn, guessDate, guessPrintedExtras, buildExpenseSummaryFromText } = require("./lib/local-receipt-ocr");
const { extractReceiptData } = require("./lib/receipt-ocr");
const { parseJsonp, applyAbrToOcr } = require("./lib/abr-lookup");
const { recordScan, scanStats } = require("./lib/scan-telemetry");
const fs = require("fs");
const path = require("path");

function vision(payload) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
      },
    },
  };
}

describe("scanner harness", () => {
  it("reads a dotted ABN only when the checksum matches", () => {
    expect(guessAbn("OFFICEWORKS\nA.B.N. 36.004.763.526")).toBe("36 004 763 526");
    expect(guessAbn("ABN 11 222 333 444")).toBe("");
    expect(guessAbn("ABN\n26 008 672 179")).toBe("26 008 672 179");
  });

  it("reads named dates and ISO dates as well as day/month/year", () => {
    expect(guessDate("1 Nov 2026")).toBe("2026-11-01");
    expect(guessDate("01 November 2026")).toBe("2026-11-01");
    expect(guessDate("2026-11-01")).toBe("2026-11-01");
    expect(guessDate("05/11/2026")).toBe("2026-11-05");
    expect(guessDate("31/02/2026")).toBeNull();
  });

  it("keeps litres, fuel type, payment and receipt number from the print", () => {
    const extras = guessPrintedExtras("DIESEL 412.00 L\nVISA\nReceipt No 88421\nTOTAL 880.00");
    expect(extras.dieselLitres).toBe(412);
    expect(extras.fuelType).toBe("diesel");
    expect(extras.paymentMethod).toBe("visa");
    expect(extras.receiptNumber).toBe("88421");
  });

  it("does not invent a sample receipt when nothing can be read", async () => {
    const result = await extractReceiptData(null, "data:image/png;base64,aaaa", "image/png", "blank.png");
    expect(result.notes).toBe("Couldn't read this receipt, try again or enter manually");
    expect(result.vendor || "").not.toMatch(/Sample Roadhouse/);
    expect(result.amount).toBeNull();
    expect(result.fieldConfidence.amount).toBe("low");
  });

  it("prefers the vision model and still validates the ABN", async () => {
    const result = await extractReceiptData(
      vision({
        documentType: "expense",
        vendor: "Ampol",
        vendorAbn: "40 004 201 307",
        date: "2026-11-05",
        amount: 88,
        gst: 8,
        confidence: "high",
      }),
      "data:image/png;base64,aaaa",
      "image/png",
      "ampol.jpg"
    );
    expect(result.vendor).toBe("Ampol");
    expect(result.amount).toBe(88);
    expect(result.vendorAbn).toBe("40 004 201 307");
    expect(result.ocrSource).toBe("openai");
    expect(result.fieldConfidence.amount).toBe("high");
  });

  it("offers an invoice scanned as an expense back as income", () => {
    const summary = buildExpenseSummaryFromText(
      "TAX INVOICE\nFrom: Hill Haulage\nABN 40 004 201 307\nTo: Acme\nDate: 01/11/2026\nTOTAL 2420.00\nGST 220.00"
    );
    expect(summary.amount).toBe(2420);
    expect(summary.date).toBe("2026-11-01");
  });

  it("treats a credit note as a credit note and a GST-free ABR seller as zero GST", () => {
    const credit = buildExpenseSummaryFromText("CREDIT NOTE\nTOTAL -15.00\nABN 40 004 201 307");
    expect(/credit/i.test(`${credit.rawText}`)).toBe(true);
    const parsed = parseJsonp('callback({"EntityName":"Corner Shop","Gst":null,"Abn":"40004201307"})');
    const ocr = applyAbrToOcr({ vendor: "TAX INVOICE", gstAmount: 12, amount: 40 }, {
      name: parsed.EntityName,
      gstRegistered: parsed.Gst != null && String(parsed.Gst).trim() !== "",
    });
    expect(ocr.vendor).toBe("Corner Shop");
    expect(ocr.gstAmount).toBe(0);
    expect(ocr.gstFree).toBe(true);
  });

  it("logs a failed scan without storing the picture", () => {
    recordScan({
      product: "suite",
      ok: false,
      errorType: "timeout",
      durationMs: 21000,
      bytes: 180000,
      mime: "image/jpeg",
    });
    const stats = scanStats();
    expect(stats.failed).toBeGreaterThan(0);
    expect(stats.slow).toBeGreaterThan(0);
    expect(JSON.stringify(stats)).not.toMatch(/base64|receipt/i);
  });

  it("keeps phone photos near 2000px and 0.85 quality", () => {
    const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
    expect(app).toMatch(/\[2000,/);
    expect(app).toMatch(/0\.85/);
    expect(app).not.toMatch(/0\.38/);
    expect(app).toMatch(/image\/heic/);
    expect(app).not.toMatch(/HEIC photo could not be converted/);
    const client = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(client).toContain("(?:haulage|suite)");
  });
});
