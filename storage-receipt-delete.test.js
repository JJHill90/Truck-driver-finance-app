const fs = require("fs");
const path = require("path");
const { deleteReceipt } = require("./lib/storage");

describe("deleteReceipt", () => {
  const receiptsDir = path.join(__dirname, "data", "receipts");
  const testFile = path.join(receiptsDir, "del-test-receipt.jpg");
  const relativePath = "receipts/del-test-receipt.jpg";

  beforeEach(() => {
    fs.mkdirSync(receiptsDir, { recursive: true });
    fs.writeFileSync(testFile, Buffer.from("fake-image"));
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  it("removes the receipt, deletes the file, and unlinks ledger rows", () => {
    const records = {
      expenses: [
        { id: "e1", receiptId: "r-del", amount: 10 },
        { id: "e2", receiptId: "other", amount: 5 },
      ],
      income: [{ id: "i1", receiptId: "r-del", amount: 100 }],
      receipts: [
        {
          id: "r-del",
          purpose: "expense",
          filename: "24.07.26 AUD$10.00.jpg",
          imagePath: relativePath,
        },
      ],
    };

    expect(deleteReceipt(records, "r-del")).toBe(true);
    expect(records.receipts).toHaveLength(0);
    expect(fs.existsSync(testFile)).toBe(false);
    expect(records.expenses[0].receiptId).toBeNull();
    expect(records.expenses[1].receiptId).toBe("other");
    expect(records.income[0].receiptId).toBeNull();
  });

  it("returns false when the receipt id is missing", () => {
    expect(deleteReceipt({ receipts: [] }, "missing")).toBe(false);
  });
});
