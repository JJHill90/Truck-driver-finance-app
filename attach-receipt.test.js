const {
  attachReceiptToEntry,
  entryNeedsReceiptAttach,
  hasRealImage,
} = require("./lib/attach-receipt");

function tinyPngDataUrl() {
  // 1x1 PNG
  return (
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  );
}

describe("attachReceiptToEntry", () => {
  it("attaches an image to an expense with no receipt and clears noReceipt", () => {
    const records = {
      expenses: [
        {
          id: "e1",
          date: "2026-08-20",
          category: "incidentals",
          amount: 3.5,
          vendor: "Vending",
          noReceipt: true,
          receiptId: null,
        },
      ],
      income: [],
      receipts: [],
    };
    const result = attachReceiptToEntry(records, "expense", "e1", {
      dataUrl: tinyPngDataUrl(),
      mimeType: "image/png",
      filename: "slip.png",
    });
    expect(result.ok).toBe(true);
    expect(result.entry.receiptId).toBeTruthy();
    expect(result.entry.noReceipt).toBe(false);
    expect(result.receipt.imagePath).toBeTruthy();
    expect(result.receipt.linkedExpenseId).toBe("e1");
    expect(result.receipt.purpose).toBe("expense");
    expect(hasRealImage(result.receipt)).toBe(true);
    expect(entryNeedsReceiptAttach(result.entry, records)).toBe(false);
  });

  it("upgrades a photo-less manual stub receipt on income", () => {
    const records = {
      expenses: [],
      income: [
        {
          id: "i1",
          date: "2026-08-15",
          type: "salary_wages",
          amount: 1200,
          entity: "Haul Co",
          receiptId: "stub-1",
        },
      ],
      receipts: [
        {
          id: "stub-1",
          source: "manual",
          purpose: "income",
          filename: "manual-entry",
          imagePath: null,
          linkedIncomeId: "i1",
        },
      ],
    };
    const result = attachReceiptToEntry(records, "income", "i1", {
      dataUrl: tinyPngDataUrl(),
      filename: "payslip.png",
    });
    expect(result.ok).toBe(true);
    expect(result.entry.receiptId).not.toBe("stub-1");
    expect(result.receipt.linkedIncomeId).toBe("i1");
    expect(records.receipts.some((r) => r.id === "stub-1")).toBe(false);
  });

  it("rejects reconciled expenses", () => {
    const records = {
      expenses: [
        {
          id: "e2",
          date: "2026-08-01",
          amount: 10,
          reconciled: true,
          receiptId: null,
        },
      ],
      income: [],
      receipts: [],
    };
    const result = attachReceiptToEntry(records, "expense", "e2", {
      dataUrl: tinyPngDataUrl(),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("reconciled");
    expect(result.status).toBe(409);
  });

  it("rejects when a real image is already linked", () => {
    const records = {
      expenses: [
        {
          id: "e3",
          date: "2026-08-01",
          amount: 10,
          receiptId: "r-img",
        },
      ],
      income: [],
      receipts: [
        {
          id: "r-img",
          imagePath: "receipts/r-img.jpg",
          linkedExpenseId: "e3",
        },
      ],
    };
    const result = attachReceiptToEntry(records, "expense", "e3", {
      dataUrl: tinyPngDataUrl(),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("already_has_receipt");
  });

  it("entryNeedsReceiptAttach is true for stubs and bare rows", () => {
    const records = {
      expenses: [
        { id: "a", receiptId: null },
        { id: "b", receiptId: "stub", reconciled: false },
        { id: "c", receiptId: "real", reconciled: false },
        { id: "d", receiptId: null, reconciled: true },
      ],
      receipts: [
        { id: "stub", imagePath: null },
        { id: "real", imagePath: "receipts/real.jpg" },
      ],
    };
    expect(entryNeedsReceiptAttach(records.expenses[0], records)).toBe(true);
    expect(entryNeedsReceiptAttach(records.expenses[1], records)).toBe(true);
    expect(entryNeedsReceiptAttach(records.expenses[2], records)).toBe(false);
    expect(entryNeedsReceiptAttach(records.expenses[3], records)).toBe(false);
  });
});
