const {
  formatLabelDate,
  formatAudAmount,
  extensionFrom,
  buildDocumentFilename,
  labelAmountFromScan,
  labelAmountFromConfirm,
} = require("./lib/document-label");

describe("formatLabelDate", () => {
  it("formats ISO dates as DD.MM.YY", () => {
    expect(formatLabelDate("2026-07-23")).toBe("23.07.26");
    expect(formatLabelDate("2014-01-05")).toBe("05.01.14");
  });

  it("accepts DD/MM/YYYY and DD.MM.YY", () => {
    expect(formatLabelDate("23/07/2026")).toBe("23.07.26");
    expect(formatLabelDate("23.07.26")).toBe("23.07.26");
  });

  it("returns null for empty/invalid", () => {
    expect(formatLabelDate("")).toBeNull();
    expect(formatLabelDate(null)).toBeNull();
  });
});

describe("formatAudAmount", () => {
  it("formats with AUD$ and two decimals", () => {
    expect(formatAudAmount(128)).toBe("AUD$128.00");
    expect(formatAudAmount(2450.5)).toBe("AUD$2450.50");
    expect(formatAudAmount("99.9")).toBe("AUD$99.90");
  });

  it("returns null for non-numeric", () => {
    expect(formatAudAmount(undefined)).toBeNull();
    expect(formatAudAmount("nope")).toBeNull();
    expect(formatAudAmount(0)).toBeNull();
  });
});

describe("extensionFrom", () => {
  it("prefers mime type over mismatched filename", () => {
    expect(extensionFrom("image/png", "scan.PDF")).toBe(".png");
    expect(extensionFrom("application/pdf", "scan.jpg")).toBe(".pdf");
  });

  it("falls back to filename when mime is unknown", () => {
    expect(extensionFrom("", "scan.PNG")).toBe(".png");
    expect(extensionFrom(null, null)).toBe(".jpg");
  });
});

describe("buildDocumentFilename", () => {
  it("labels image receipts as date + AUD$ amount", () => {
    expect(
      buildDocumentFilename({
        date: "2026-07-23",
        amount: 85.4,
        mimeType: "image/jpeg",
        originalFilename: "IMG_1234.jpg",
      })
    ).toBe("23.07.26 AUD$85.40.jpg");
  });

  it("labels PDF invoices with .pdf extension", () => {
    expect(
      buildDocumentFilename({
        date: "2025-12-01",
        amount: 3200,
        mimeType: "application/pdf",
        originalFilename: "payslip.pdf",
      })
    ).toBe("01.12.25 AUD$3200.00.pdf");
  });

  it("keeps original name when date/amount missing", () => {
    expect(
      buildDocumentFilename({
        mimeType: "image/jpeg",
        originalFilename: "receipt.jpg",
      })
    ).toBe("receipt.jpg");
  });
});

describe("label amount helpers", () => {
  it("prefers gross for income scans", () => {
    expect(labelAmountFromScan({ amount: 900, grossTotal: 1200 }, "income")).toBe(1200);
    expect(labelAmountFromScan({ amount: 45.5 }, "expense")).toBe(45.5);
  });

  it("prefers gross on income confirm", () => {
    expect(labelAmountFromConfirm({ amount: 900, grossTotal: 1200 }, "income")).toBe(1200);
    expect(labelAmountFromConfirm({ amount: 45.5 }, "expense")).toBe(45.5);
  });
});
