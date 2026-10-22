const fs = require("fs");
const path = require("path");
const { updateExpense, updateIncome } = require("./lib/ledger-edit");

describe("updateExpense", () => {
  it("updates editable fields and preserves id / receiptId / createdAt", () => {
    const records = {
      expenses: [
        {
          id: "e1",
          date: "2026-01-10",
          category: "other_work",
          amount: 20,
          vendor: "Shop",
          vendorAbn: "",
          description: "old",
          receiptId: "r1",
          createdAt: "2026-01-10T00:00:00.000Z",
          workUsePercent: 100,
          reimbursed: false,
        },
      ],
    };
    const updated = updateExpense(records, "e1", {
      date: "08/05/2026",
      category: "meals_dinner",
      amount: 45.5,
      vendor: "Woolworths",
      vendorAbn: "88 000 014 675",
      description: "groceries",
      workUsePercent: 80,
      cashTransaction: true,
      noReceipt: true,
      vendingMachine: true,
    });
    expect(updated.id).toBe("e1");
    expect(updated.receiptId).toBe("r1");
    expect(updated.createdAt).toBe("2026-01-10T00:00:00.000Z");
    expect(updated.date).toBe("2026-05-08");
    expect(updated.category).toBe("meals_dinner");
    expect(updated.amount).toBe(45.5);
    expect(updated.vendor).toBe("Woolworths");
    expect(updated.vendorAbn).toBe("88000014675");
    expect(updated.description).toBe("groceries");
    expect(updated.workUsePercent).toBe(80);
    expect(updated.cashTransaction).toBe(true);
    expect(updated.noReceipt).toBe(true);
    expect(updated.vendingMachine).toBe(true);
    expect(updated.updatedAt).toBeTruthy();
  });

  it("returns null when the expense is missing", () => {
    expect(updateExpense({ expenses: [] }, "missing", { amount: 1 })).toBeNull();
  });

  it("leaves fields out of the patch unchanged", () => {
    const records = {
      expenses: [
        {
          id: "e2",
          date: "2026-01-10",
          category: "meals",
          amount: 20,
          vendor: "Shop",
          notes: "keep me",
          reimbursed: false,
        },
      ],
    };
    const updated = updateExpense(records, "e2", { vendor: "Woolworths" });
    expect(updated.vendor).toBe("Woolworths");
    expect(updated.amount).toBe(20);
    expect(updated.notes).toBe("keep me");
    expect(updated.reimbursed).toBe(false);
    expect(updated.date).toBe("2026-01-10");
  });
});

describe("updateIncome", () => {
  it("updates payslip-style fields", () => {
    const records = {
      income: [
        {
          id: "i1",
          date: "2026-02-01",
          type: "salary_wages",
          amount: 1000,
          entity: "Haul Co",
          payer: "Haul Co",
          grossTotal: 1000,
          taxableIncome: 900,
          gstAmount: 0,
          netPay: 800,
          receiptId: "r2",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    };
    const updated = updateIncome(records, "i1", {
      date: "2026-02-15",
      amount: 1200,
      entity: "Haul Co Pty Ltd",
      grossTotal: 1200,
      taxableIncome: 1100,
      netPay: 950,
      payPeriod: "01/02/2026 – 14/02/2026",
      summaryNotes: "corrected",
    });
    expect(updated.id).toBe("i1");
    expect(updated.receiptId).toBe("r2");
    expect(updated.date).toBe("2026-02-15");
    expect(updated.amount).toBe(1200);
    expect(updated.entity).toBe("Haul Co Pty Ltd");
    expect(updated.payer).toBe("Haul Co Pty Ltd");
    expect(updated.grossTotal).toBe(1200);
    expect(updated.taxableIncome).toBe(1100);
    expect(updated.netPay).toBe(950);
    expect(updated.payPeriod).toBe("01/02/2026 – 14/02/2026");
    expect(updated.summaryNotes).toBe("corrected");
  });

  it("updates Living Away from Home / Travel allowance days", () => {
    const records = {
      income: [
        {
          id: "i2",
          date: "2026-03-01",
          type: "salary_wages",
          amount: 2000,
          overnightDays: 0,
          travelAllowanceAmount: null,
        },
      ],
    };
    const updated = updateIncome(records, "i2", {
      overnightDays: 3,
      overnightDaysSource: "manual_edit",
      travelAllowanceAmount: 168.84,
    });
    expect(updated.overnightDays).toBe(3);
    expect(updated.overnightDaysSource).toBe("manual_edit");
    expect(updated.travelAllowanceAmount).toBe(168.84);
  });
});

describe("ledger edit modal", () => {
  it("opens a field picker so only chosen ledger fields are edited", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(src).toMatch(/Tick the fields you want to change/);
    expect(src).toMatch(/data-edit-field/);
    expect(src).toMatch(/data-edit-continue/);
    expect(src).toMatch(/data-edit-select-all/);
    expect(src).toMatch(/function selectedLedgerPayload/);
    expect(src).toMatch(/Change fields/);
    expect(src).toMatch(/function syncSaveBtn/);
    expect(src).toMatch(/data-edit-save/);
    expect(src).toMatch(/ledger-edit-save-btn/);
  });
});
