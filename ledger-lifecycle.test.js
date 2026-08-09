const {
  isActive,
  isReconciled,
  isDeleted,
  activeEntries,
  withActiveLedger,
  reconcileEntries,
  unreconcileEntries,
  softDeleteEntry,
  restoreEntry,
  assertEditable,
} = require("./lib/ledger-lifecycle");

function makeRecords() {
  return {
    expenses: [
      { id: "e1", amount: 10, category: "meals", date: "2026-08-01" },
      { id: "e2", amount: 20, category: "fuel", date: "2026-08-02" },
    ],
    income: [{ id: "i1", amount: 100, type: "salary_wages", date: "2026-08-01" }],
  };
}

describe("ledger-lifecycle reconcile", () => {
  it("marks selected active rows reconciled", () => {
    const records = makeRecords();
    const result = reconcileEntries(records, "expense", ["e1", "missing"], {
      username: "JJHill90",
    });
    expect(result.updated).toHaveLength(1);
    expect(result.notFound).toEqual(["missing"]);
    expect(isReconciled(records.expenses[0])).toBe(true);
    expect(records.expenses[0].reconciledBy).toBe("JJHill90");
    expect(isReconciled(records.expenses[1])).toBe(false);
  });

  it("unreconciles rows for admin override", () => {
    const records = makeRecords();
    reconcileEntries(records, "expense", ["e1"], { username: "JJHill90" });
    const result = unreconcileEntries(records, "expense", ["e1"], {
      username: "Haulage_Admin",
    });
    expect(result.updated).toHaveLength(1);
    expect(isReconciled(records.expenses[0])).toBe(false);
    expect(records.expenses[0].unreconciledBy).toBe("Haulage_Admin");
  });
});

describe("ledger-lifecycle soft-delete", () => {
  it("blocks delete of reconciled rows unless forced", () => {
    const records = makeRecords();
    reconcileEntries(records, "expense", ["e1"], { username: "dave" });
    const blocked = softDeleteEntry(records, "expense", "e1", { username: "dave" });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("reconciled");
    expect(isActive(records.expenses[0])).toBe(true);

    const forced = softDeleteEntry(records, "expense", "e1", {
      username: "Haulage_Admin",
      force: true,
    });
    expect(forced.ok).toBe(true);
    expect(isDeleted(records.expenses[0])).toBe(true);
  });

  it("soft-deletes and restores", () => {
    const records = makeRecords();
    const del = softDeleteEntry(records, "income", "i1", { username: "dave" });
    expect(del.ok).toBe(true);
    expect(activeEntries(records.income)).toHaveLength(0);
    expect(withActiveLedger(records).income).toHaveLength(0);

    const restored = restoreEntry(records, "income", "i1", { username: "Haulage_Admin" });
    expect(restored.ok).toBe(true);
    expect(isActive(records.income[0])).toBe(true);
    expect(records.income[0].restoredBy).toBe("Haulage_Admin");
  });

  it("assertEditable blocks reconciled and deleted rows", () => {
    const records = makeRecords();
    expect(assertEditable(records.expenses[0]).ok).toBe(true);
    reconcileEntries(records, "expense", ["e1"], { username: "dave" });
    expect(assertEditable(records.expenses[0]).code).toBe("reconciled");
    softDeleteEntry(records, "expense", "e2", { username: "dave" });
    expect(assertEditable(records.expenses[1]).code).toBe("deleted");
  });
});
