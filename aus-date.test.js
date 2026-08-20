const {
  toIsoAusDate,
  financialYearForAusDate,
  extractBestDocumentDate,
  resolveDocumentDate,
  expandTwoDigitYear,
  isPlausibleDocumentYear,
} = require("./lib/aus-date");

/** Fixed "today" so year-window tests do not drift. */
const NOW = new Date(2026, 7, 2); // 2 Aug 2026

describe("toIsoAusDate", () => {
  it("treats DD/MM/YYYY as Australian (08/05/2026 → 8 May 2026)", () => {
    expect(toIsoAusDate("08/05/2026", NOW)).toBe("2026-05-08");
    expect(toIsoAusDate("8/5/26", NOW)).toBe("2026-05-08");
    expect(toIsoAusDate("08.05.2026", NOW)).toBe("2026-05-08");
  });

  it("accepts ISO and long AU forms", () => {
    expect(toIsoAusDate("2026-05-08", NOW)).toBe("2026-05-08");
    expect(toIsoAusDate("8 May 2026", NOW)).toBe("2026-05-08");
  });

  it("rejects impossible calendar dates", () => {
    expect(toIsoAusDate("32/13/2026", NOW)).toBeNull();
    expect(toIsoAusDate("2026-13-01", NOW)).toBeNull();
  });

  it("rejects far-future OCR years (20/07/70 → not 2070)", () => {
    expect(expandTwoDigitYear(70, NOW)).toBeNull();
    expect(isPlausibleDocumentYear(2070, NOW)).toBe(false);
    expect(toIsoAusDate("20/07/70", NOW)).toBeNull();
    expect(toIsoAusDate("2070-07-20", NOW)).toBeNull();
    expect(toIsoAusDate("20/07/26", NOW)).toBe("2026-07-20");
  });
});

describe("financialYearForAusDate", () => {
  it("places 8 May 2026 in FY 2025-26 (not 2024-25)", () => {
    expect(financialYearForAusDate("08/05/2026")).toBe("2025-26");
    expect(financialYearForAusDate("2026-05-08")).toBe("2025-26");
  });

  it("places 1 July 2026 in FY 2026-27 and 30 June 2026 in FY 2025-26", () => {
    expect(financialYearForAusDate("01/07/2026")).toBe("2026-27");
    expect(financialYearForAusDate("30/06/2026")).toBe("2025-26");
  });
});

describe("extractBestDocumentDate / resolveDocumentDate", () => {
  it("prefers invoice/payment date over a leading YTD period start", () => {
    const text = `
      YTD 01/07/2024 to 30/06/2025
      Statement period from 01/07/2024
      Invoice date 08/05/2026
      TOTAL $42.50
    `;
    const best = extractBestDocumentDate(text, "expense");
    expect(best.date).toBe("2026-05-08");
    expect(best.rank).toBeGreaterThanOrEqual(90);

    // Simulate local OCR guessDate taking the first date on the page.
    const resolved = resolveDocumentDate({
      ocrDate: "2024-07-01",
      rawText: text,
      purpose: "expense",
    });
    expect(resolved).toBe("2026-05-08");
    expect(financialYearForAusDate(resolved)).toBe("2025-26");
  });

  it("prefers payment date on income documents over period-from", () => {
    const text = `
      Pay period 29/04/2026 – 05/05/2026
      Payment date 08/05/2026
      Net pay $1,200.00
    `;
    const resolved = resolveDocumentDate({
      ocrDate: "2026-04-29",
      rawText: text,
      purpose: "income",
      payPeriod: { paymentDate: "2026-05-08", to: "2026-05-05", from: "2026-04-29" },
    });
    expect(resolved).toBe("2026-05-08");
    expect(financialYearForAusDate(resolved)).toBe("2025-26");
  });

  it("keeps a sole unlabeled receipt date when it is the only hit", () => {
    const text = "BP Truck Stop\n08/05/2026\nDiesel $120.00";
    expect(resolveDocumentDate({ ocrDate: "2026-05-08", rawText: text, purpose: "expense" })).toBe(
      "2026-05-08"
    );
  });

  it("does not invent FY 2070 from an OCR year misread as 70", () => {
    const text = "WOOLWORTHS\n20/07/70\nTOTAL $62.40";
    const resolved = resolveDocumentDate({
      ocrDate: "2070-07-20",
      rawText: text,
      purpose: "expense",
      now: NOW,
    });
    expect(resolved).toBeNull();
    expect(toIsoAusDate("2070-07-20", NOW)).toBeNull();
  });

  it("prefers a plausible date when OCR also offers a far-future year", () => {
    const text = "Receipt date 20/07/26\nPrinted 20/07/70\nTOTAL $18.00";
    const resolved = resolveDocumentDate({
      ocrDate: "2070-07-20",
      rawText: text,
      purpose: "expense",
      now: NOW,
    });
    expect(resolved).toBe("2026-07-20");
    expect(financialYearForAusDate(resolved, NOW)).toBe("2026-27");
  });

  it("does not treat bare TAX INVOICE as a strong date label", () => {
    const text = `
TAX INVOICE
BP Archerfield
Total $16.90
Invoice date 20/08/26
`;
    const best = extractBestDocumentDate(text, "expense", new Date(2026, 7, 20));
    expect(best.date).toBe("2026-08-20");
    expect(best.rank).toBeGreaterThanOrEqual(75);
  });

  it("repairs OCR month 06→08 on a same-day thermal EFTPOS timestamp", () => {
    const now = new Date(2026, 7, 20, 21, 0, 0); // 20 Aug 2026
    const text = `
BP Archerfield
Total $16.90
DEBIT 16.90
20/06/26 20:56
APPROVED 00
`;
    const resolved = resolveDocumentDate({
      ocrDate: "2026-06-20",
      rawText: text,
      purpose: "expense",
      now,
    });
    expect(resolved).toBe("2026-08-20");
  });

  it("repairs month-digit OCR slips on any same-day thermal receipt (not just BP)", () => {
    const now = new Date(2026, 7, 20, 21, 0, 0);
    const text = `
United Crestmead
TAX INVOICE
Total $55.00
20/06/26 20:40
APPROVED
`;
    const resolved = resolveDocumentDate({
      ocrDate: "2026-06-20",
      rawText: text,
      purpose: "expense",
      now,
    });
    expect(resolved).toBe("2026-08-20");
  });
});
