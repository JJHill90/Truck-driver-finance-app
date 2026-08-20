const {
  extractLabeledExpenseTotals,
  extractPaymentTenders,
  pickBestExpenseTotal,
  refineExpenseDetectedTotals,
  looksLikeGluedAmount,
} = require("./lib/expense-total");
const { buildComponentBreakdown } = require("./lib/document-breakdown");
const { mergeDetectedTotals } = require("./lib/receipt-ocr");

const UNITED_RECEIPT = `
Welcome to United Crestmead
169-175 Bumstead Road, CRESTMEAD QLD 4132
Store ABN: 93 507 513 119
Fuel ABN: 52 995 832 068
TAX INVOICE
*PEPSI MAX 440ML                    4.50
*P: 2 DIESEL                       $94.94
37.99L @ 2.499 $/L
SALE TOTAL:                         $99.44
EFTPOS:                            $99.44
GST total in sale:                  $9.04
SALE    AUD    $99.44
APPROVED
PLEASE RETAIN RECEIPT
`;

describe("extractLabeledExpenseTotals", () => {
  it("finds SALE TOTAL and TOTAL amounts on the same line", () => {
    const text = `
      Diesel 150.00
      VISA 45.00
      SALE TOTAL $187.50
    `;
    const hits = extractLabeledExpenseTotals(text);
    expect(hits[0].amount).toBe(187.5);
    expect(hits[0].label).toMatch(/sale total/i);
  });

  it("finds TOTAL on the next line after the label", () => {
    const text = "Coffee 4.50\nTOTAL\n$62.40\n";
    const hits = extractLabeledExpenseTotals(text);
    expect(hits.some((h) => h.amount === 62.4 && /total/i.test(h.label))).toBe(true);
  });

  it("ignores subtotal and card tenders as payable totals", () => {
    const text = `
      SUBTOTAL 100.00
      VISA 100.00
      TOTAL GST 9.09
    `;
    const hits = extractLabeledExpenseTotals(text);
    expect(hits.every((h) => h.amount !== 9.09 || h.rank < 80)).toBe(true);
    expect(hits.find((h) => /visa/i.test(h.raw))).toBeUndefined();
  });

  it("reads United SALE TOTAL:$99.44 and ignores GST total in sale", () => {
    const hits = extractLabeledExpenseTotals(UNITED_RECEIPT);
    expect(hits[0].amount).toBe(99.44);
    expect(hits[0].label).toMatch(/sale total/i);
    expect(hits.every((h) => h.amount !== 9.04)).toBe(true);
  });

  it("does not treat a leading-dot cents fragment as $44", () => {
    const hits = extractLabeledExpenseTotals("SALE TOTAL .44\nEFTPOS 99.44\n");
    expect(hits.every((h) => h.amount !== 44)).toBe(true);
  });
});

describe("extractPaymentTenders", () => {
  it("captures EFTPOS / SALE AUD corroborating amounts", () => {
    const tenders = extractPaymentTenders(UNITED_RECEIPT);
    expect(tenders.some((t) => t.amount === 99.44)).toBe(true);
  });
});

describe("looksLikeGluedAmount", () => {
  it("detects an extra leading digit glued onto the real total", () => {
    expect(looksLikeGluedAmount(599.44, 99.44)).toBe(true);
    expect(looksLikeGluedAmount(99.44, 99.44)).toBe(false);
    expect(looksLikeGluedAmount(187.5, 45)).toBe(false);
  });
});

describe("pickBestExpenseTotal", () => {
  it("prefers SALE TOTAL over a smaller OCR/VISA amount", () => {
    const best = pickBestExpenseTotal({
      ocrAmount: 45,
      rawText: "VISA 45.00\nSALE TOTAL 187.50\n",
      lineItems: [
        { description: "VISA", amount: 45 },
        { description: "SALE TOTAL", amount: 187.5 },
      ],
    });
    expect(best.amount).toBe(187.5);
    expect(best.label).toMatch(/sale total/i);
    expect(best.rank).toBeGreaterThanOrEqual(90);
  });

  it("prefers TOTAL over largest line item when OCR amount is wrong", () => {
    const best = pickBestExpenseTotal({
      ocrAmount: 45,
      rawText: "Item A 45.00\nItem B 120.25\nTOTAL 187.50\n",
    });
    expect(best.amount).toBe(187.5);
  });

  it("locks United SALE TOTAL at $99.44", () => {
    const best = pickBestExpenseTotal({
      ocrAmount: 4.5,
      rawText: UNITED_RECEIPT,
    });
    expect(best.amount).toBe(99.44);
    expect(best.label).toMatch(/sale total/i);
  });

  it("repairs SALE TOTAL 599.44 when EFTPOS shows 99.44", () => {
    const best = pickBestExpenseTotal({
      ocrAmount: 599.44,
      rawText: `
        *P: 2 DIESEL $94.94
        SALE TOTAL
        599.44
        EFTPOS $99.44
        SALE AUD $99.44
      `,
    });
    expect(best.amount).toBe(99.44);
    expect(best.label).toMatch(/sale total/i);
    expect(best.source).toMatch(/repair/i);
  });

  it("repairs SALE TOTAL 0.44 when EFTPOS shows 99.44", () => {
    const best = pickBestExpenseTotal({
      ocrAmount: 0.44,
      rawText: `
        *PEPSI MAX 4.50
        *DIESEL $94.94
        SALE TOTAL
        0.44
        EFTPOS: $99.44
      `,
    });
    expect(best.amount).toBe(99.44);
    expect(best.label).toMatch(/sale total/i);
  });

  it("keeps SALE TOTAL when card tender is a different smaller amount", () => {
    const best = pickBestExpenseTotal({
      ocrAmount: 45,
      rawText: "Diesel 150.00\nVISA 45.00\nSALE TOTAL 187.50\n",
    });
    expect(best.amount).toBe(187.5);
  });

  it("handles SALE TOTAL 5$99.44 glue without preferring $5", () => {
    const best = pickBestExpenseTotal({
      ocrAmount: 5,
      rawText: "SALE TOTAL 5$99.44\nEFTPOS 99.44\n",
    });
    expect(best.amount).toBe(99.44);
  });
});

describe("breakdown + refine pipeline", () => {
  it("locks Grand/Sale total to SALE TOTAL even when ocr.amount is a card tender", () => {
    const ocr = {
      amount: 45,
      rawText: "Diesel 150.00\nAdBlue 20.45\nCoffee 4.50\nVISA 45.00\nSALE TOTAL 187.50\n",
      lineItems: [
        { description: "Diesel", amount: 150 },
        { description: "VISA", amount: 45 },
      ],
    };
    const { components } = buildComponentBreakdown(ocr, false);
    const grand = components.find((c) => c.type === "total");
    expect(grand.amount).toBe(187.5);

    const merged = mergeDetectedTotals(ocr, components, "expense");
    const refined = refineExpenseDetectedTotals(merged, ocr, components);
    const primary = refined.find((t) => t.primary);
    expect(primary.amount).toBe(187.5);
    expect(primary.label).toMatch(/total/i);
  });

  it("refines United glued OCR 599.44 down to SALE TOTAL 99.44", () => {
    const ocr = {
      amount: 599.44,
      rawText: `
        TAX INVOICE
        *PEPSI MAX 440ML 4.50
        *P: 2 DIESEL $94.94
        SALE TOTAL
        599.44
        EFTPOS: $99.44
        GST total in sale: $9.04
        SALE AUD $99.44
      `,
      lineItems: [
        { description: "PEPSI MAX", amount: 4.5 },
        { description: "DIESEL", amount: 94.94 },
      ],
    };
    const { components } = buildComponentBreakdown(ocr, false);
    const grand = components.find((c) => c.type === "total");
    expect(grand.amount).toBe(99.44);

    const merged = mergeDetectedTotals(ocr, components, "expense");
    const refined = refineExpenseDetectedTotals(merged, ocr, components);
    const primary = refined.find((t) => t.primary);
    expect(primary.amount).toBe(99.44);
    expect(primary.label).toMatch(/sale total/i);
  });
});

describe("BP Archerfield-style GST vs DEBIT totals", () => {
  const BP_RECEIPT = `
BP Archerfield
Boundary Rd, Rocklea, QLD 4106
Rampage Retail Pty Ltd
ABN 66 600 817 178
TAX INVOICE
1 HH GRILL FISH & SALA 16.90
Total $ 16.90
BPrewards 0.00
DEBIT 16.90
GST Amount 1.54
nab EFTPOS
20/08/26 20:56
APPROVED 00
`;

  it("prefers TOTAL $16.90 on a clean BP docket", () => {
    const pick = pickBestExpenseTotal({ ocrAmount: 16.9, rawText: BP_RECEIPT });
    expect(pick.amount).toBe(16.9);
  });

  it("repairs TOTAL misread as GST when DEBIT corroborates", () => {
    const degraded = BP_RECEIPT.replace("Total $ 16.90", "Total $ 1.54");
    const pick = pickBestExpenseTotal({ ocrAmount: 1.54, rawText: degraded });
    expect(pick.amount).toBe(16.9);
    expect(pick.source).toMatch(/repaired|tender/i);
  });

  it("prefers DEBIT when OCR amount is GST and TOTAL label is missing", () => {
    const noTotal = `
BP Archerfield
HH GRILL FISH & SALA 16.90
DEBIT 16.90
GST Amount 1.54
`;
    const pick = pickBestExpenseTotal({ ocrAmount: 1.54, rawText: noTotal });
    expect(pick.amount).toBe(16.9);
  });
});
