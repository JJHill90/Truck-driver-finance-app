const {
  needsVendorRepair,
  isConfidentVendor,
  repairVendorsFromScans,
} = require("./lib/vendor-repair");

function baseRecords() {
  return {
    profile: {},
    vendors: [],
    expenses: [],
    income: [],
    receipts: [],
  };
}

describe("needsVendorRepair / isConfidentVendor", () => {
  it("flags empty and OCR junk vendors", () => {
    expect(needsVendorRepair({ vendor: "" })).toBe(true);
    expect(needsVendorRepair({ vendor: "P E WHEY TAA" })).toBe(true);
    expect(needsVendorRepair({ vendor: "TAX INVOICE" })).toBe(true);
    expect(needsVendorRepair({ vendor: "Woolworths" })).toBe(false);
    expect(needsVendorRepair({ vendor: "BP", deletedAt: "2026-01-01" })).toBe(false);
  });

  it("accepts clean chain names as confident", () => {
    expect(isConfidentVendor("Woolworths")).toBe(true);
    expect(isConfidentVendor("Ampol")).toBe(true);
    expect(isConfidentVendor("P E WHEY TAA")).toBe(false);
    expect(isConfidentVendor("")).toBe(false);
  });
});

describe("repairVendorsFromScans", () => {
  it("repairs junk expense vendor from stored Woolworths OCR text", async () => {
    const r = baseRecords();
    r.receipts.push({
      id: "r1",
      mimeType: "image/jpeg",
      filename: "ww.jpg",
      createdAt: "2026-07-01T02:00:00.000Z",
      ocrResult: {
        vendor: "P E WHEY TAA",
        rawText: "Woolworths\nFresh Food People\nABN 88 000 014 675\nTOTAL $45.20",
      },
    });
    r.expenses.push({
      id: "e1",
      date: "2026-07-01",
      vendor: "P E WHEY TAA",
      amount: 45.2,
      category: "other_work",
      receiptId: "r1",
    });

    const preview = await repairVendorsFromScans(r, { dryRun: true });
    expect(preview.updated).toBe(1);
    expect(preview.details[0].to).toBe("Woolworths");
    expect(r.expenses[0].vendor).toBe("P E WHEY TAA"); // dry-run

    const applied = await repairVendorsFromScans(r, { dryRun: false });
    expect(applied.updated).toBe(1);
    expect(r.expenses[0].vendor).toBe("Woolworths");
    expect(r.expenses[0].category).toBe("groceries_travel");
    expect(r.receipts[0].ocrResult.vendor).toBe("Woolworths");
  });

  it("repairs Ampol from Foodary / ABN cues in stored text", async () => {
    const r = baseRecords();
    r.receipts.push({
      id: "r2",
      mimeType: "image/jpeg",
      filename: "ampol.jpg",
      ocrResult: {
        vendor: "XqR7",
        rawText: "Ampol Foodary\nABN 64 000 175 342\nDiesel 120.00\nTOTAL $120.00",
        vendorAbn: "64 000 175 342",
      },
    });
    r.expenses.push({
      id: "e2",
      vendor: "XqR7",
      amount: 120,
      category: "other_work",
      receiptId: "r2",
    });

    const result = await repairVendorsFromScans(r, { dryRun: false });
    expect(result.updated).toBe(1);
    expect(r.expenses[0].vendor).toMatch(/^Ampol/i);
  });

  it("does not overwrite a good vendor name", async () => {
    const r = baseRecords();
    r.receipts.push({
      id: "r3",
      ocrResult: {
        vendor: "Woolworths",
        rawText: "Woolworths\nTOTAL $10.00",
      },
    });
    r.expenses.push({
      id: "e3",
      vendor: "Woolworths Metro Capalaba",
      amount: 10,
      receiptId: "r3",
    });

    const result = await repairVendorsFromScans(r, { dryRun: false });
    expect(result.updated).toBe(0);
    expect(r.expenses[0].vendor).toBe("Woolworths Metro Capalaba");
  });

  it("skips rows with no attached receipt", async () => {
    const r = baseRecords();
    r.expenses.push({ id: "e4", vendor: "P E WHEY TAA", amount: 5 });
    const result = await repairVendorsFromScans(r, { dryRun: false });
    expect(result.updated).toBe(0);
    expect(result.details[0].reason).toBe("no_receipt");
  });

  it("leaves still-unidentified scans alone when text has no chain cues", async () => {
    const r = baseRecords();
    r.receipts.push({
      id: "r5",
      ocrResult: {
        vendor: "a BE a oe",
        rawText: "Thank you\nTOTAL $8.00\nPlease retain",
      },
    });
    r.expenses.push({
      id: "e5",
      vendor: "a BE a oe",
      amount: 8,
      receiptId: "r5",
    });

    const result = await repairVendorsFromScans(r, { dryRun: false });
    expect(result.updated).toBe(0);
    expect(r.expenses[0].vendor).toBe("a BE a oe");
  });
});
