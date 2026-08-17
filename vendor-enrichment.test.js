const {
  isValidAbn,
  extractAbnFromText,
  findKnownVendor,
  suggestCategoryFromText,
  suggestCategoryFromVendorContent,
  inferBusinessTypeCategory,
  enrichOcrFromVendors,
  rememberVendor,
  formatAbn,
  looksLikeJunkVendor,
  resolveCanonicalVendor,
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

  it("ignores labeled ABNs that fail the checksum", () => {
    const text = "BP Truck Stop\nABN: 12 345 678 901\nTOTAL $42.50";
    expect(extractAbnFromText(text)).toBe("");
  });

  it("prefers supplier ABN over an earlier customer ABN", () => {
    const text = [
      "Customer ABN: 51 824 753 556",
      "BP Truck Stop",
      "ABN: 53 004 085 616",
      "TOTAL $42.50",
    ].join("\n");
    expect(extractAbnFromText(text)).toBe("53 004 085 616");
  });
});

describe("suggestCategoryFromText", () => {
  it("suggests meals for cafe/restaurant wording", () => {
    expect(suggestCategoryFromText("Cafe latte and toast", "Roadhouse Cafe")).toBe("meals");
  });

  it("suggests meals for coffee / snack wording without a cafe vendor", () => {
    expect(suggestCategoryFromText("Cappuccino\nChocolate bar\nTOTAL 8.50", "")).toBe("meals");
  });

  it("suggests training_education for course wording", () => {
    expect(suggestCategoryFromText("Heavy vehicle driver training course", "HV Training Co")).toBe(
      "training_education"
    );
  });

  it("suggests groceries_travel for supermarket wording", () => {
    expect(suggestCategoryFromText("TOTAL 45.00", "Woolworths")).toBe("groceries_travel");
  });
});

describe("inferBusinessTypeCategory", () => {
  it("maps Woolworths / Coles by name to groceries_travel", () => {
    expect(inferBusinessTypeCategory({ name: "Woolworths" })).toBe("groceries_travel");
    expect(inferBusinessTypeCategory({ name: "Coles Supermarket" })).toBe("groceries_travel");
    expect(inferBusinessTypeCategory({ name: "ALDI" })).toBe("groceries_travel");
  });

  it("maps Woolworths Group ABN to groceries_travel", () => {
    expect(inferBusinessTypeCategory({ abn: "88 000 014 675" })).toBe("groceries_travel");
  });

  it("maps Bunnings to tools_equipment", () => {
    expect(inferBusinessTypeCategory({ name: "Bunnings Warehouse" })).toBe("tools_equipment");
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

  it("forces groceries_travel for Woolworths even when OCR says other_work", () => {
    const ocr = {
      vendor: "Woolworths",
      vendorAbn: "",
      suggestedCategory: "other_work",
      rawText: "WOOLWORTHS\nABN 88 000 014 675\nTOTAL 62.40",
    };
    enrichOcrFromVendors(ocr, [], "expense");
    expect(ocr.suggestedCategory).toBe("groceries_travel");
    expect(ocr.categorySource).toBe("business_type");
  });

  it("overrides wrong strong OCR and bad vendor memory with business type", () => {
    const vendors = [
      {
        id: "w1",
        name: "Woolworths Group",
        abn: "88000014675",
        defaultCategory: "tools_equipment",
      },
    ];
    const ocr = {
      vendor: "Woolworths",
      vendorAbn: "88 000 014 675",
      suggestedCategory: "office_admin",
      rawText: "WOOLWORTHS",
    };
    enrichOcrFromVendors(ocr, vendors, "expense");
    expect(ocr.suggestedCategory).toBe("groceries_travel");
    expect(ocr.categorySource).toBe("business_type");
    expect(vendors[0].defaultCategory).toBe("groceries_travel");
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

  it("stores groceries_travel for Woolworths even if confirm category was other_work", () => {
    const records = { vendors: [] };
    const v = rememberVendor(records, {
      name: "Woolworths",
      abn: "88 000 014 675",
      category: "other_work",
    });
    expect(v.defaultCategory).toBe("groceries_travel");
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

describe("canonical vendor names from OCR junk", () => {
  it("flags TAX INVOICE and consonant salad as junk vendors", () => {
    expect(looksLikeJunkVendor("TAX INVOICE")).toBe(true);
    expect(looksLikeJunkVendor("XqR7m")).toBe(true);
    expect(looksLikeJunkVendor("")).toBe(true);
    expect(looksLikeJunkVendor("Joe's Roadhouse")).toBe(false);
    expect(looksLikeJunkVendor("7-Eleven")).toBe(false);
  });

  it("resolves garbled 7-Eleven spellings in the vendor field", () => {
    expect(resolveCanonicalVendor({ vendor: "7 EIEVEN" }).name).toBe("7-Eleven");
    expect(resolveCanonicalVendor({ vendor: "seven eleven" }).name).toBe("7-Eleven");
    expect(resolveCanonicalVendor({ vendor: "l-eleven" }).name).toBe("7-Eleven");
    expect(resolveCanonicalVendor({ vendor: "7eleven" }).name).toBe("7-Eleven");
  });

  it("pulls 7-Eleven from receipt text when OCR vendor is random letters", () => {
    const hit = resolveCanonicalVendor({
      vendor: "XqR7m",
      text: "XqR7m\n7 EIEVEN STORE 2145\nDIESEL\nTOTAL 80.00",
    });
    expect(hit.name).toBe("7-Eleven");
    expect(hit.source).toBe("raw_text");
  });

  it("does not replace a plausible independent vendor with a brand later on the docket", () => {
    const hit = resolveCanonicalVendor({
      vendor: "Joe's Roadhouse",
      text: "Joe's Roadhouse\nBP Fleet card accepted\nTOTAL 20.00",
    });
    expect(hit).toBeNull();
  });

  it("enrichOcrFromVendors rewrites junk vendor to 7-Eleven", () => {
    const ocr = {
      vendor: "TAX INVOICE",
      vendorAbn: "",
      suggestedCategory: "other_work",
      rawText: "TAX INVOICE\n7-ELEVEN\nABN 12 345 678 901\nTOTAL 15.50",
    };
    enrichOcrFromVendors(ocr, [], "expense");
    expect(ocr.vendor).toBe("7-Eleven");
    expect(ocr.vendorCanonical.name).toBe("7-Eleven");
  });

  it("tidies near-correct chain spellings (Woolworths / McDonald's)", () => {
    const wool = {
      vendor: "WOOLWORTHS",
      suggestedCategory: "other_work",
      rawText: "WOOLWORTHS\nTOTAL 40.00",
    };
    enrichOcrFromVendors(wool, [], "expense");
    expect(wool.vendor).toBe("Woolworths");
    expect(wool.suggestedCategory).toBe("groceries_travel");

    const maccas = {
      vendor: "Mcdona1ds",
      suggestedCategory: "other_work",
      rawText: "Mcdona1ds\nMeal deal\nTOTAL 12.00",
    };
    enrichOcrFromVendors(maccas, [], "expense");
    expect(maccas.vendor).toBe("McDonald's");
    expect(maccas.suggestedCategory).toBe("meals");
  });

  it("prefers remembered spelling when OCR name loosely matches", () => {
    const vendors = [{ id: "v7", name: "7-Eleven", abn: "", defaultCategory: null }];
    const ocr = {
      vendor: "7 Eleven Pty",
      vendorAbn: "",
      suggestedCategory: "other_work",
      rawText: "7 Eleven Pty\nTOTAL 9.00",
    };
    enrichOcrFromVendors(ocr, vendors, "expense");
    expect(ocr.vendor).toBe("7-Eleven");
    expect(ocr.vendorMatch.source).toBe("name");
  });
});

describe("dual-purpose vendor content (7-Eleven / servo food vs fuel)", () => {
  it("classifies 7-Eleven coffee and snacks as meals, not other_work", () => {
    expect(
      suggestCategoryFromVendorContent({
        name: "7-Eleven",
        text: "7-ELEVEN\nCAPPUCCINO\nCHOC BAR\nTOTAL 9.80",
      })
    ).toBe("meals");

    const ocr = {
      vendor: "7-Eleven",
      suggestedCategory: "other_work",
      rawText: "7-ELEVEN STORE 2145\nCoffee\nSlurpee\nChips\nTOTAL 12.40",
    };
    enrichOcrFromVendors(ocr, [], "expense");
    expect(ocr.suggestedCategory).toBe("meals");
    expect(ocr.categorySource).toBe("vendor_content");
  });

  it("classifies 7-Eleven diesel / pump lines as fuel", () => {
    expect(
      suggestCategoryFromVendorContent({
        name: "7-Eleven",
        text: "7-ELEVEN\nDIESEL\n42.10 L @ 1.899\nTOTAL 80.00",
      })
    ).toBe("fuel");

    const ocr = {
      vendor: "TAX INVOICE",
      suggestedCategory: "other_work",
      rawText: "TAX INVOICE\n7 EIEVEN\nUNLEADED 91\nPUMP 3\nTOTAL 55.00",
    };
    enrichOcrFromVendors(ocr, [], "expense");
    expect(ocr.vendor).toBe("7-Eleven");
    expect(ocr.suggestedCategory).toBe("fuel");
  });

  it("prefers fuel when both fuel and a drink appear (bowser + bottle)", () => {
    expect(
      suggestCategoryFromVendorContent({
        name: "BP",
        text: "BP Truck Stop\nDIESEL 80.00 L\nWater 3.50\nTOTAL 155.00",
      })
    ).toBe("fuel");
  });

  it("defaults bare 7-Eleven dockets to meals instead of other_work", () => {
    const ocr = {
      vendor: "7-Eleven",
      suggestedCategory: "other_work",
      rawText: "7-Eleven\nABN 12 345 678 901\nTOTAL 6.50",
    };
    enrichOcrFromVendors(ocr, [], "expense");
    expect(ocr.suggestedCategory).toBe("meals");
  });

  it("keeps Woolworths on groceries_travel (not dual-purpose food override)", () => {
    const ocr = {
      vendor: "Woolworths",
      suggestedCategory: "other_work",
      rawText: "WOOLWORTHS\nCoffee pods\nTOTAL 40.00",
    };
    enrichOcrFromVendors(ocr, [], "expense");
    expect(ocr.suggestedCategory).toBe("groceries_travel");
    expect(ocr.categorySource).toBe("business_type");
  });
});
