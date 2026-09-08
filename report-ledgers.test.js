const {
  summariseExpensesByCategory,
  summariseIncomeByVendor,
} = require("./lib/report-ledgers");

describe("summariseExpensesByCategory", () => {
  it("rolls transactions into category totals and skips soft-deleted rows", () => {
    const rows = summariseExpensesByCategory(
      [
        {
          date: "2026-03-10",
          category: "incidentals",
          amount: 4.5,
          workUsePercent: 100,
          vendingMachine: true,
          noReceipt: true,
        },
        {
          date: "2026-03-11",
          category: "incidentals",
          amount: 12,
          workUsePercent: 100,
        },
        {
          date: "2026-03-12",
          category: "meals",
          amount: 25,
          workUsePercent: 100,
        },
        {
          date: "2026-03-13",
          category: "meals",
          amount: 99,
          workUsePercent: 100,
          deletedAt: "2026-03-14T00:00:00.000Z",
        },
        {
          date: "2025-01-01",
          category: "fuel",
          amount: 200,
          workUsePercent: 100,
        },
      ],
      "2025-26"
    );

    expect(rows).toHaveLength(2);
    const incidentals = rows.find((r) => r.category === "incidentals");
    const meals = rows.find((r) => r.category === "meals");
    expect(incidentals.count).toBe(2);
    expect(incidentals.amountTotal).toBe(16.5);
    expect(incidentals.deductibleTotal).toBe(16.5);
    expect(incidentals.vendingCount).toBe(1);
    expect(incidentals.noReceiptCount).toBe(1);
    expect(meals.count).toBe(1);
    expect(meals.amountTotal).toBe(25);
  });
});

describe("summariseIncomeByVendor", () => {
  it("groups by payer/entity and builds a roaming assessable total", () => {
    const rows = summariseIncomeByVendor(
      [
        {
          date: "2026-08-10",
          payer: "Betts Transport",
          type: "salary_wages",
          amount: 2000,
          grossTotal: 2500,
        },
        {
          date: "2026-08-17",
          entity: "Betts Transport",
          type: "salary_wages",
          amount: 2100,
          grossTotal: 2600,
        },
        {
          date: "2026-09-01",
          payer: "Acme Haulage",
          type: "salary_wages",
          amount: 1500,
          grossTotal: 1800,
        },
        {
          date: "2025-02-01",
          payer: "Old Co",
          amount: 500,
          grossTotal: 500,
        },
      ],
      "2026-27"
    );

    expect(rows.map((r) => r.vendor)).toEqual(["Acme Haulage", "Betts Transport"]);
    expect(rows[0].count).toBe(1);
    expect(rows[0].grossTotal).toBe(1800);
    expect(rows[0].assessableTotal).toBe(1500);
    expect(rows[0].runningTotal).toBe(1500);

    expect(rows[1].count).toBe(2);
    expect(rows[1].grossTotal).toBe(5100);
    expect(rows[1].assessableTotal).toBe(4100);
    expect(rows[1].runningTotal).toBe(5600);
  });
});
