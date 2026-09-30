const rec = require("./lib/recurring-expenses");

function emptyRecords() {
  return { expenses: [], recurringExpenses: [] };
}

function addExpense(records, payload) {
  const entry = {
    id: `e-${records.expenses.length + 1}`,
    ...payload,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  records.expenses.unshift(entry);
  return entry;
}

describe("recurring expenses", () => {
  it("advances weekly, fortnightly, monthly (clamped), and yearly", () => {
    expect(rec.addFrequency("2026-10-01", "weekly")).toBe("2026-10-08");
    expect(rec.addFrequency("2026-10-01", "fortnightly")).toBe("2026-10-15");
    expect(rec.addFrequency("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(rec.addFrequency("2026-10-01", "quarterly")).toBe("2027-01-01");
    expect(rec.addFrequency("2024-02-29", "yearly")).toBe("2025-02-28");
  });

  it("posts the start date then waits for the next period", () => {
    const records = emptyRecords();
    const made = rec.createTemplate(
      records,
      {
        amount: 100,
        category: "super_personal",
        description: "Super",
        recurringFrequency: "weekly",
        recurringStartDate: "2026-10-01",
      },
      { firstPostedDate: "2026-10-01" }
    );
    expect(made.ok).toBe(true);
    expect(made.template.nextDue).toBe("2026-10-08");
    const { created } = rec.materializeDue(records, { addExpense, today: "2026-10-01" });
    expect(created).toHaveLength(0);
  });

  it("catches up missed weeks up to today without posting the future", () => {
    const records = emptyRecords();
    rec.createTemplate(records, {
      amount: 100,
      category: "super_personal",
      description: "Super",
      recurringFrequency: "weekly",
      recurringStartDate: "2026-10-01",
    });
    const { created } = rec.materializeDue(records, { addExpense, today: "2026-10-22" });
    expect(created.map((e) => e.date)).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
    expect(records.recurringExpenses[0].nextDue).toBe("2026-10-29");
    const again = rec.materializeDue(records, { addExpense, today: "2026-10-22" });
    expect(again.created).toHaveLength(0);
  });

  it("does not post a future start date", () => {
    const records = emptyRecords();
    rec.createTemplate(records, {
      amount: 80,
      category: "other_work",
      recurringFrequency: "monthly",
      recurringStartDate: "2026-11-01",
    });
    const { created } = rec.materializeDue(records, { addExpense, today: "2026-10-15" });
    expect(created).toHaveLength(0);
    expect(records.recurringExpenses[0].nextDue).toBe("2026-11-01");
  });

  it("stops further posts after stopTemplate", () => {
    const records = emptyRecords();
    const made = rec.createTemplate(records, {
      amount: 50,
      category: "other_work",
      recurringFrequency: "daily",
      recurringStartDate: "2026-10-01",
    });
    rec.materializeDue(records, { addExpense, today: "2026-10-01" });
    rec.stopTemplate(records, made.template.id);
    const after = rec.materializeDue(records, { addExpense, today: "2026-10-05" });
    expect(after.created).toHaveLength(0);
    expect(records.expenses).toHaveLength(1);
  });

  it("detects the recurring flag on a save payload", () => {
    expect(rec.wantsRecurring({ recurring: true })).toBe(true);
    expect(rec.wantsRecurring({ recurring: "on" })).toBe(true);
    expect(rec.wantsRecurring({})).toBe(false);
  });

  it("marks a future start as awaiting first post", () => {
    const records = emptyRecords();
    const made = rec.createTemplate(records, {
      amount: 100,
      description: "Super",
      recurringFrequency: "weekly",
      recurringStartDate: "2026-11-01",
    });
    const view = rec.presentTemplate(made.template, "2026-10-15");
    expect(view.awaitingFirst).toBe(true);
    expect(view.frequencyLabel).toBe("Weekly");
    expect(made.template.notes).toMatch(/weekly/i);
    rec.materializeDue(records, { addExpense, today: "2026-11-01" });
    const after = rec.presentTemplate(records.recurringExpenses[0], "2026-11-01");
    expect(after.awaitingFirst).toBe(false);
    expect(after.lastPostedDate).toBe("2026-11-01");
  });

  it("skips a date that already has a matching ledger row", () => {
    const records = emptyRecords();
    const made = rec.createTemplate(records, {
      amount: 100,
      description: "Super",
      recurringFrequency: "weekly",
      recurringStartDate: "2026-10-01",
    });
    records.expenses.push({
      id: "pre",
      date: "2026-10-01",
      recurringId: made.template.id,
      amount: 100,
    });
    const { created } = rec.materializeDue(records, { addExpense, today: "2026-10-08" });
    expect(created.map((e) => e.date)).toEqual(["2026-10-08"]);
  });
});
