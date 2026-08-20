const { moveEntry, moveEntries, expenseToIncomePayload, incomeToExpensePayload } = require("./lib/ledger-move");

function blankRecords() {
  return { expenses: [], income: [], receipts: [], vendors: [], profile: {} };
}

describe("ledger-move payloads", () => {
  it("maps expense fields into an income payload", () => {
    const payload = expenseToIncomePayload({
      date: "2025-09-12",
      amount: 128.5,
      vendor: "BP Truck Stop",
      vendorAbn: "12345678901",
      description: "Diesel",
      category: "fuel",
      notes: "Night fill",
      receiptId: "r1",
    });
    expect(payload.date).toBe("2025-09-12");
    expect(payload.amount).toBe(128.5);
    expect(payload.entity).toBe("BP Truck Stop");
    expect(payload.payer).toBe("BP Truck Stop");
    expect(payload.grossTotal).toBe(128.5);
    expect(payload.receiptId).toBe("r1");
    expect(payload.summaryNotes).toMatch(/ABN/);
    expect(payload.type).toBe("salary_wages");
  });

  it("maps income fields into an expense payload", () => {
    const payload = incomeToExpensePayload({
      date: "2025-09-12",
      amount: 1900,
      grossTotal: 2540,
      entity: "Demo Fleet",
      type: "salary_wages",
      description: "Payslip",
      summaryNotes: "Week 1",
      receiptId: "r2",
    });
    expect(payload.date).toBe("2025-09-12");
    expect(payload.amount).toBe(1900);
    expect(payload.vendor).toBe("Demo Fleet");
    expect(payload.category).toBe("other_work");
    expect(payload.receiptId).toBe("r2");
    expect(payload.notes).toMatch(/Week 1/);
  });
});

describe("moveEntry", () => {
  it("moves expense to income, soft-deletes source, rewires receipt", () => {
    const records = blankRecords();
    records.expenses.push({
      id: "e1",
      date: "2025-09-12",
      category: "fuel",
      amount: 100,
      vendor: "7-Eleven",
      description: "Fuel",
      receiptId: "rcpt1",
      createdAt: "2025-09-12T00:00:00.000Z",
    });
    records.receipts.push({
      id: "rcpt1",
      purpose: "expense",
      linkedExpenseId: "e1",
      linkedIncomeId: null,
      filename: "12.09.25 AUD$100.00.jpg",
    });

    const result = moveEntry(records, "expense", "e1", { username: "test_admin" });
    expect(result.ok).toBe(true);
    expect(result.to.type).toBe("salary_wages");
    expect(result.to.amount).toBe(100);
    expect(result.to.entity).toBe("7-Eleven");
    expect(result.to.movedFromId).toBe("e1");
    expect(result.to.movedFromType).toBe("expense");
    expect(result.to.adminMovedBy).toBe("test_admin");
    expect(result.from.deletedAt).toBeTruthy();
    expect(result.from.receiptId).toBeNull();
    expect(records.income[0].id).toBe(result.to.id);
    expect(records.receipts[0].purpose).toBe("income");
    expect(records.receipts[0].linkedIncomeId).toBe(result.to.id);
    expect(records.receipts[0].linkedExpenseId).toBeNull();
  });

  it("moves income to expense and rewires receipt", () => {
    const records = blankRecords();
    records.income.push({
      id: "i1",
      date: "2025-09-12",
      type: "salary_wages",
      amount: 500,
      grossTotal: 500,
      entity: "Acme",
      description: "Misfiled payslip",
      receiptId: "rcpt2",
      createdAt: "2025-09-12T00:00:00.000Z",
    });
    records.receipts.push({
      id: "rcpt2",
      purpose: "income",
      linkedIncomeId: "i1",
      linkedExpenseId: null,
    });

    const result = moveEntry(records, "income", "i1", { username: "test_admin" });
    expect(result.ok).toBe(true);
    expect(result.to.category).toBe("other_work");
    expect(result.to.vendor).toBe("Acme");
    expect(result.to.amount).toBe(500);
    expect(result.to.movedFromType).toBe("income");
    expect(result.from.deletedAt).toBeTruthy();
    expect(records.receipts[0].purpose).toBe("expense");
    expect(records.receipts[0].linkedExpenseId).toBe(result.to.id);
    expect(records.receipts[0].linkedIncomeId).toBeNull();
  });

  it("refuses already soft-deleted rows", () => {
    const records = blankRecords();
    records.expenses.push({
      id: "e2",
      date: "2025-09-12",
      amount: 10,
      deletedAt: "2025-09-13T00:00:00.000Z",
    });
    const result = moveEntry(records, "expense", "e2", { username: "test_admin" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("deleted");
  });

  it("moveEntries reports per-id errors", () => {
    const records = blankRecords();
    records.expenses.push({
      id: "ok",
      date: "2025-09-12",
      amount: 40,
      vendor: "Coles",
      category: "groceries_travel",
      createdAt: "2025-09-12T00:00:00.000Z",
    });
    const result = moveEntries(records, "expense", ["ok", "missing"], { username: "test_admin" });
    expect(result.movedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe("missing");
  });
});
