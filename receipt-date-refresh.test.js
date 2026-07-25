const { refreshInvoiceDatesFromScans, validDate } = require("./lib/receipt-date-refresh");

// These cases use receipts that already carry an OCR date, so no file re-scan is
// needed — keeping the test deterministic and fast.
function baseRecords() {
  return {
    profile: {},
    vendors: [],
    expenses: [],
    income: [],
    receipts: [],
  };
}

describe("validDate", () => {
  it("accepts YYYY-MM-DD and rejects junk", () => {
    expect(validDate("2026-06-02")).toBe("2026-06-02");
    expect(validDate("2026-13-02")).toBeNull();
    expect(validDate("02/06/2026")).toBeNull();
    expect(validDate(null)).toBeNull();
  });
});

describe("refreshInvoiceDatesFromScans", () => {
  it("repairs a row still showing the upload day", async () => {
    const r = baseRecords();
    r.receipts.push({
      id: "r1",
      mimeType: "application/pdf",
      filename: "doc.pdf",
      createdAt: "2026-07-25T02:00:00.000Z",
      ocrResult: { date: "2026-06-02" },
    });
    r.income.push({
      id: "i1",
      date: "2026-07-25", // equals upload day → eligible
      createdAt: "2026-07-25T02:00:00.000Z",
      amount: 3116.8,
      grossTotal: 3116.8,
      receiptId: "r1",
    });

    const result = await refreshInvoiceDatesFromScans(r, { openai: null });
    expect(result.updated).toBe(1);
    expect(r.income[0].date).toBe("2026-06-02");
    expect(r.income[0].uploadedDate).toBe("2026-07-25");
  });

  it("never touches a date the user set deliberately", async () => {
    const r = baseRecords();
    r.receipts.push({
      id: "r2",
      mimeType: "application/pdf",
      createdAt: "2026-07-25T02:00:00.000Z",
      ocrResult: { date: "2026-06-02" },
    });
    r.expenses.push({
      id: "e1",
      date: "2024-01-15", // deliberately set, != upload day
      createdAt: "2026-07-25T02:00:00.000Z",
      amount: 60,
      receiptId: "r2",
    });

    const result = await refreshInvoiceDatesFromScans(r, { openai: null });
    expect(result.updated).toBe(0);
    expect(r.expenses[0].date).toBe("2024-01-15");
  });

  it("is a no-op when the invoice date already matches", async () => {
    const r = baseRecords();
    r.receipts.push({
      id: "r3",
      createdAt: "2026-06-02T02:00:00.000Z",
      ocrResult: { date: "2026-06-02" },
    });
    r.income.push({
      id: "i2",
      date: "2026-06-02",
      createdAt: "2026-06-02T02:00:00.000Z",
      amount: 100,
      receiptId: "r3",
    });

    const result = await refreshInvoiceDatesFromScans(r, { openai: null });
    expect(result.updated).toBe(0);
    expect(r.income[0].date).toBe("2026-06-02");
    expect(r.income[0].uploadedDate).toBeUndefined();
  });

  it("ignores entries with no linked receipt", async () => {
    const r = baseRecords();
    r.income.push({ id: "i3", date: "2026-07-25", createdAt: "2026-07-25T00:00:00.000Z", amount: 50 });
    const result = await refreshInvoiceDatesFromScans(r, { openai: null });
    expect(result.updated).toBe(0);
  });
});
