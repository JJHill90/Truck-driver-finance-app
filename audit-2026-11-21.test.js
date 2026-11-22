/**
 * 21 Nov 2026 live audit. Suite and Hub stay on separate rules.
 */
const { findDuplicateMatches } = require("./lib/duplicate-receipt");
const { softDeleteEntry } = require("./lib/ledger-lifecycle");
const { listMenuCategories } = require("./lib/suite/menus");
const { supportInbox } = require("./lib/support");
const { buildAccountantReport } = require("./lib/suite/tax");
const { assessIncomeCompliance } = require("./lib/document-breakdown");
const { buildLodgementBrief } = require("./lib/accountant-brief");
const { mapExpenseSchedule } = require("./lib/ato-return-labels");
const { buildBasPack } = require("./lib/suite/bas-pack");
const { estimateFuelTaxCredit } = require("./lib/fuel-tax-credit");
const { assessOvernightMeal } = require("./lib/overnight-meal-allowance");
const { buildHubGstTracker } = require("./lib/hub-gst-tracker");

describe("21 Nov — duplicate confirm warns and ignores orphan photos", () => {
  const records = {
    expenses: [{ id: "e1", date: "2026-11-05", vendor: "BP", amount: 79.95 }],
    income: [],
    receipts: [
      {
        id: "orphan",
        purpose: "expense",
        filename: "05.11.26 AUD$79.95.jpg",
        ocrResult: { date: "2026-11-05", vendor: "BP", amount: 79.95 },
      },
      {
        id: "linked",
        purpose: "expense",
        linkedExpenseId: "e1",
        ocrResult: { date: "2026-11-05", vendor: "BP", amount: 79.95 },
      },
    ],
  };

  it("does not match an orphan photo or the receipt being approved", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "2026-11-05", vendor: "BP Crestmead", amount: 79.95 },
      "expense",
      79.95,
      { excludeReceiptId: "linked" }
    );
    expect(matches.map((m) => m.id)).toEqual(["e1"]);
    expect(matches.some((m) => m.source === "receipt")).toBe(false);
  });
});

describe("21 Nov — deleting a ledger row soft-deletes its photo", () => {
  it("marks the linked receipt deleted with the expense", () => {
    const records = {
      expenses: [{ id: "e1", date: "2026-11-05", vendor: "BP", amount: 79.95, receiptId: "photo" }],
      receipts: [{ id: "photo", linkedExpenseId: "e1", filename: "bp.jpg" }],
    };
    const result = softDeleteEntry(records, "expense", "e1", { username: "driver" });
    expect(result.ok).toBe(true);
    expect(records.expenses[0].deletedAt).toBeTruthy();
    expect(records.receipts[0].deletedAt).toBeTruthy();
    expect(records.receipts[0].deletedWithLedgerId).toBe("e1");
  });
});

describe("21 Nov — Suite menu, disclaimer and support address", () => {
  it("puts Fuel (work car) on the manual expense menu", () => {
    const fuel = listMenuCategories("employee").find((c) => c.id === "fuel");
    expect(fuel && fuel.label).toMatch(/Fuel \(work car/);
  });

  it("drops truck-driver wording from the Suite EOFY footer", () => {
    const report = buildAccountantReport(
      { income: [], expenses: [] },
      { financialYear: "2026-27", entityType: "employee", name: "Alex" }
    );
    expect(report.disclaimer).not.toMatch(/truck-driver/i);
    expect(report.disclaimer).toMatch(/sole trader and partnership/);
  });

  it("uses a Suite support address", () => {
    expect(supportInbox("suite")).toBe(
      String(process.env.SUITE_SUPPORT_EMAIL || "support@gotaxationsuite.com")
    );
    expect(supportInbox("suite")).not.toMatch(/godriverhub/i);
  });
});

describe("21 Nov — Hub report, FTC, meals and GST tracker", () => {
  it("does not flag an owner-driver invoice for SG or PAYG", () => {
    const c = assessIncomeCompliance(
      {
        suggestedIncomeType: "remittance_owner",
        documentKind: "invoice",
        grossTotal: 6600,
        vendor: "Toll",
      },
      { components: [] },
      "2026-27"
    );
    expect(c.checks.find((row) => row.name === "Superannuation Guarantee")).toBeUndefined();
    expect(c.checks.find((row) => row.name === "PAYG withholding")).toBeUndefined();
  });

  it("describes owner-driver-only income as a business schedule", () => {
    const brief = buildLodgementBrief(
      {
        income: [{ id: "i1", date: "2026-11-12", type: "remittance_owner", amount: 6600, entity: "Toll" }],
        expenses: [],
      },
      { name: "Alex", driverType: "local", financialYear: "2026-27" },
      {
        financialYear: "2026-27",
        income: { breakdown: [], paygWithheld: 0 },
        expenses: { breakdown: [], deductibleTotal: 0 },
        taxEstimate: {},
      },
      { product: "haulage", entitlements: { isProPlus: true } }
    );
    expect(brief.entityLabel).toBe("Sole trader");
    expect(brief.returnTitle).toMatch(/business schedule/i);
  });

  it("puts Hub tolls on D2 and leaves Suite tolls on D1", () => {
    expect(mapExpenseSchedule("parking_tolls", "D2", { product: "haulage" }).code).toBe("D2");
    expect(mapExpenseSchedule("parking_tolls", "D1 or D2", { product: "suite" }).code).toBe("D1");
  });

  it("asks for diesel litres and adds BAS 7D from the rate table", () => {
    const credit = estimateFuelTaxCredit({
      litres: 412,
      date: "2026-11-05",
      use: "on_road",
    });
    expect(credit.basLabel).toBe("7D");
    expect(credit.litres).toBe(412);
    expect(credit.options.map((row) => row.id)).toEqual(["on_road", "off_road"]);
    const pack = buildBasPack(
      {
        income: [],
        expenses: [{ date: "2026-11-05", amount: 80, category: "fuel", fuelTaxCredit: credit }],
      },
      { financialYear: "2026-27", gstRegistered: true },
      { financialYear: "2026-27", product: "haulage" }
    );
    expect(pack.boxes.find((row) => row.atoBox === "7D").amount).toBe(credit.amount);
    const suite = buildBasPack(
      { income: [], expenses: [] },
      { financialYear: "2026-27" },
      { financialYear: "2026-27", product: "suite" }
    );
    expect(suite.boxes.find((row) => row.atoBox === "7D")).toBeUndefined();
  });

  it("compares an overnight meal with the TD 2026/4 dinner amount", () => {
    const within = assessOvernightMeal({
      category: "meals_dinner",
      amount: 40,
      financialYear: "2026-27",
    });
    const over = assessOvernightMeal({
      category: "meals_dinner",
      amount: 80,
      financialYear: "2026-27",
    });
    expect(within.determination).toBe("TD 2026/4");
    expect(within.cap).toBe(63.45);
    expect(within.within).toBe(true);
    expect(over.within).toBe(false);
  });

  it("tracks Hub GST turnover from business income only", () => {
    const tracker = buildHubGstTracker(
      {
        income: [
          { date: "2026-11-12", type: "salary_wages", amount: 2950 },
          { date: "2026-11-12", type: "allowance_travel", amount: 180 },
          { date: "2026-11-12", type: "remittance_owner", amount: 6600 },
        ],
      },
      "2026-27"
    );
    expect(tracker.recorded).toBe(6000);
    expect(tracker.threshold).toBe(75000);
    expect(tracker.product).toBe("haulage");
  });
});
