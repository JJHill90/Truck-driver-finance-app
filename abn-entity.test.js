const {
  collectAbnCandidates,
  pickBestAbnCandidate,
  applyAbnEntityPairing,
} = require("./lib/abn-entity");
const { extractAbnFromText } = require("./lib/vendor-enrichment");

describe("abn-entity pairing", () => {
  it("prefers supplier ABN + attached entity over a customer ABN listed first", () => {
    const text = [
      "TAX INVOICE",
      "Customer ABN: 51 824 753 556",
      "Roadhouse Cafe Pty Ltd",
      "ABN: 53 004 085 616",
      "TOTAL $42.50",
    ].join("\n");

    const picked = pickBestAbnCandidate(text);
    expect(picked.best.formatted).toBe("53 004 085 616");
    expect(picked.best.entity).toMatch(/Roadhouse Cafe/i);

    const ocr = {
      vendor: "TAX INVOICE",
      vendorAbn: "",
      amount: 42.5,
      rawText: text,
    };
    applyAbnEntityPairing(ocr, "expense");
    expect(ocr.vendorAbn).toBe("53 004 085 616");
    expect(ocr.vendor).toMatch(/Roadhouse Cafe/i);
    expect(ocr.amount).toBe(42.5);
  });

  it("pairs employer ABN with entity on payslips", () => {
    const text = [
      "PAYSLIP",
      "Haulage Co Pty Ltd",
      "ABN 88 000 014 675",
      "Employee: Dave Driver",
      "Gross pay $1,200.00",
      "Net pay $900.00",
    ].join("\n");

    const ocr = {
      entity: "",
      vendor: "",
      vendorAbn: "",
      grossTotal: 1200,
      amount: 900,
      rawText: text,
    };
    applyAbnEntityPairing(ocr, "income");
    expect(ocr.vendorAbn).toBe("88 000 014 675");
    expect(ocr.entity).toMatch(/Haulage Co/i);
    expect(ocr.grossTotal).toBe(1200);
    expect(ocr.amount).toBe(900);
  });

  it("rejects invalid checksum ABNs", () => {
    const text = "Bogus Shop\nABN: 12 345 678 901\nTOTAL $10.00";
    expect(collectAbnCandidates(text)).toHaveLength(0);
    expect(extractAbnFromText(text)).toBe("");
  });

  it("keeps a stronger header ABN when OCR already stored a weak footer hit", () => {
    const text = [
      "Bunnings Warehouse",
      "ABN: 26 008 672 179",
      "Hammer $20.00",
      "TOTAL $20.00",
      "Customer copy ABN 51 824 753 556",
    ].join("\n");
    const ocr = {
      vendor: "Hammer",
      vendorAbn: "51 824 753 556",
      rawText: text,
    };
    applyAbnEntityPairing(ocr, "expense");
    expect(ocr.vendorAbn).toBe("26 008 672 179");
    expect(ocr.vendor).toMatch(/Bunnings/i);
  });
});
