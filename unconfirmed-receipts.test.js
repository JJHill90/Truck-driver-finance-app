const {
  isAwaitingConfirm,
  isMissingLinkedLedger,
  listAwaitingConfirm,
  listMissingLinkedLedger,
  receiptPurpose,
} = require("./lib/unconfirmed-receipts");

describe("unconfirmed-receipts", () => {
  it("flags income scans that have an image but no linkedIncomeId", () => {
    const receipt = {
      id: "r1",
      purpose: "income",
      hasImage: true,
      ocrResult: { amount: 100 },
    };
    expect(isAwaitingConfirm(receipt, "income")).toBe(true);
    expect(isAwaitingConfirm(receipt, "expense")).toBe(false);
    expect(listAwaitingConfirm([receipt], "income")).toHaveLength(1);
  });

  it("does not flag receipts already linked to income", () => {
    const receipt = {
      id: "r2",
      purpose: "income",
      hasImage: true,
      linkedIncomeId: "i1",
    };
    expect(isAwaitingConfirm(receipt)).toBe(false);
  });

  it("detects soft-deleted income still linked from the gallery", () => {
    const receipt = {
      id: "r3",
      purpose: "income",
      hasImage: true,
      linkedIncomeId: "i-gone",
    };
    expect(isMissingLinkedLedger(receipt, [], [])).toBe(true);
    expect(
      isMissingLinkedLedger(receipt, [{ id: "i-gone", receiptId: "r3" }], [])
    ).toBe(false);
    expect(listMissingLinkedLedger([receipt], [], [], "income")).toHaveLength(1);
  });

  it("infers purpose from OCR document type when purpose missing", () => {
    const receipt = {
      id: "r4",
      hasImage: true,
      ocrResult: { documentType: "income" },
    };
    expect(receiptPurpose(receipt)).toBe("income");
    expect(isAwaitingConfirm(receipt, "income")).toBe(true);
  });
});
