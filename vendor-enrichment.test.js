const {
  isValidAbn,
  extractAbnFromText,
  findKnownVendor,
  suggestCategoryFromText,
  enrichOcrFromVendors,
  rememberVendor,
  formatAbn,
} = require("./lib/vendor-enrichment");

describe("ABN helpers", () => {
  it("validates a real-format ABN checksum", () => {
    // Well-known valid ABN: 53 004 085 616 (Australian Taxation Office)
    expect(isValidAbn("53004085616")).toBe(true);
    expect(isValidAbn("53 004 085 616")).toBe(true);
    expect(isValidAbn("12345678901")).toBe(false);
  });

  it("extracts labeled ABN from receipt text", () => {
    const text = "BP Truck Stop\nABN: 53 004 085 616\nTOTAL $42.50";
    expect(extractAbnFromText(text)).toBe("53 004 085 616");
  });
});

describe("suggestCategoryFromText", () => {
  it("suggests meals for cafe/restaurant wording", () => {
    expect(suggestCategoryFromText("Cafe latte and toast", "Roadhouse Cafe")).toBe("meals");
  });

  it("suggests training_education for course wording", () => {
    expect(suggestCategoryFromText("Heavy vehicle driver training course", "HV Training Co")).toBe(
      "training_education"
    );
  });
});

describe("enrichOcrFromVendors", () => {
  it("fills business name from remembered ABN and applies default category", () => {
    const vendors = [
      {
        id: "v1",
        name: "Roadhouse Cafe Pty Ltd",
        abn: "53004085616",
        defaultCategory: "meals",
      },
    ];
    const ocr = {
      vendor: "",
      vendorAbn: "53 004 085 616",
      suggestedCategory: "other_work",
      rawText: "ABN 53 004 085 616\nTOTAL 25.00",
    };
    enrichOcrFromVendors(ocr, vendors, "expense");
    expect(ocr.vendor).toBe("Roadhouse Cafe Pty Ltd");
    expect(ocr.suggestedCategory).toBe("meals");
    expect(ocr.vendorMatch.source).toBe("abn");
    expect(ocr.categorySource).toBe("vendor_memory");
  });

  it("fills ABN from remembered name and categorises from text when OCR is weak", () => {
    const vendors = [{ id: "v2", name: "Skills RTO", abn: "51824753556", defaultCategory: null }];
    const ocr = {
      vendor: "Skills RTO Pty Ltd",
      vendorAbn: "",
      suggestedCategory: "other_work",
      rawText: "Skills RTO\nDriver training course\nTOTAL 450.00",
    };
    enrichOcrFromVendors(ocr, vendors, "expense");
    expect(formatAbn(ocr.vendorAbn)).toBe("51 824 753 556");
    expect(ocr.suggestedCategory).toBe("training_education");
  });

  it("extracts ABN from raw text when OCR missed it", () => {
    const ocr = {
      vendor: "Mystery Shop",
      vendorAbn: "",
      suggestedCategory: "other_work",
      rawText: "Mystery Shop\nABN 53 004 085 616\nDinner meal\nTOTAL 30.00",
    };
    enrichOcrFromVendors(ocr, [], "expense");
    expect(ocr.vendorAbn).toBe("53 004 085 616");
    expect(ocr.suggestedCategory).toBe("meals");
  });
});

describe("rememberVendor", () => {
  it("stores defaultCategory on the vendor for later scans", () => {
    const records = { vendors: [] };
    const v = rememberVendor(records, {
      name: "Roadhouse Cafe",
      abn: "53 004 085 616",
      category: "meals",
    });
    expect(v.defaultCategory).toBe("meals");
    expect(normaliseDigits(v.abn)).toBe("53004085616");

    const ocr = {
      vendorAbn: "53004085616",
      suggestedCategory: "other_work",
      rawText: "ABN 53004085616",
    };
    enrichOcrFromVendors(ocr, records.vendors, "expense");
    expect(ocr.vendor).toBe("Roadhouse Cafe");
    expect(ocr.suggestedCategory).toBe("meals");
  });
});

function normaliseDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

describe("findKnownVendor", () => {
  it("matches by ABN first", () => {
    const vendors = [{ id: "1", name: "Alpha", abn: "53004085616" }];
    const hit = findKnownVendor(vendors, { vendorAbn: "53 004 085 616", vendor: "Other" });
    expect(hit.source).toBe("abn");
    expect(hit.vendor.name).toBe("Alpha");
  });
});
