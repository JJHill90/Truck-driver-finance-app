const fs = require("fs");
const os = require("os");
const path = require("path");
const extraEntity = require("./lib/suite/extra-entity");
const partnershipSeat = require("./lib/suite/partnership-seat");
const basPack = require("./lib/suite/bas-pack");
const yearCompare = require("./lib/year-compare");
const accountantShare = require("./lib/accountant-share");
const dataDir = require("./lib/data-dir");
const { applySubscriptionToUser, configuredPriceId } = require("./lib/billing-stripe");

describe("extra entity", () => {
  it("stores one side sole trader and scopes ledger rows", () => {
    const profile = extraEntity.applyExtraEntities(
      { entityType: "employee", name: "Alex" },
      [{ entityType: "sole_trader", tradingName: "Alex Haulage", gstRegistered: true, annualSalary: 22000 }]
    );
    expect(profile.extraEntities).toHaveLength(1);
    expect(profile.extraEntities[0].entityType).toBe("sole_trader");
    profile.activeEntityId = profile.extraEntities[0].id;
    extraEntity.ensureExtraEntities(profile);
    const records = {
      profile,
      expenses: [
        { id: "e1", amount: 10, entityId: "primary" },
        { id: "e2", amount: 40, entityId: profile.extraEntities[0].id },
      ],
      income: [{ id: "i1", amount: 100 }],
    };
    extraEntity.stampActiveEntity(records, { amount: 5 });
    expect(records.expenses[0]).toBeTruthy();
    const scoped = extraEntity.scopeRecords(records);
    expect(scoped.profile.entityType).toBe("sole_trader");
    expect(scoped.expenses).toHaveLength(1);
    expect(scoped.expenses[0].id).toBe("e2");
    expect(scoped.income).toHaveLength(0);
  });
});

describe("partnership seat", () => {
  it("seats a second partner onto the owner ledger", () => {
    const users = {
      alice: { username: "alice" },
      bob: { username: "bob" },
    };
    const records = { profile: { entityType: "partnership", partnershipName: "A & B" } };
    const seat = partnershipSeat.invitePartner({
      ownerUsername: "alice",
      partnerUsername: "bob",
      ownerRecords: records,
      getUserRecord: (name) => users[name],
      saveUser: (user) => {
        users[user.username] = user;
      },
    });
    expect(seat.partner).toBe("bob");
    expect(users.bob.partnershipOwner).toBe("alice");
    expect(partnershipSeat.resolveLedgerUsername("bob", (name) => users[name])).toBe("alice");
  });
});

describe("BAS pack", () => {
  it("uses 1/11 GST on GST-inclusive totals for a quarter", () => {
    const pack = basPack.buildBasPack(
      {
        income: [{ date: "2026-08-15", amount: 1100 }],
        expenses: [{ date: "2026-08-16", amount: 220 }],
      },
      { entityType: "sole_trader", gstRegistered: true, financialYear: "2026-27" },
      { financialYear: "2026-27", quarter: "q1" }
    );
    expect(pack.eligible).toBe(true);
    expect(pack.sales).toBe(1100);
    expect(pack.purchases).toBe(220);
    expect(pack.gstOnSales).toBe(100);
    expect(pack.gstOnPurchases).toBe(20);
    expect(pack.netGst).toBe(80);
    expect(basPack.gstInclusive(110)).toBe(10);
    expect(pack.boxes.map((b) => b.atoBox)).toEqual(["G1", "1A", "G11", "1B", "9"]);
    expect(pack.boxes.find((b) => b.id === "G1").amount).toBe(1100);
    expect(pack.boxes.find((b) => b.id === "1A").amount).toBe(100);
    expect(pack.boxes.find((b) => b.id === "9").amount).toBe(80);
    expect(pack.boxes.find((b) => b.id === "9").direction).toBe("pay");
    expect(pack.officialForm).toBe(false);
    expect(pack.documentKind).toBe("gst_activity_statement_worksheet");
    expect(pack.dueDate).toBe("2026-10-28");
    expect(pack.period.start).toBe("2026-07-01");
    expect(pack.period.end).toBe("2026-09-30");
    expect(pack.identity.abnFormatted).toBeNull();
    expect(pack.note).toMatch(/not a lodged activity statement/i);
  });

  it("keeps GST-free rows in G1/G11 but out of 1A/1B", () => {
    const pack = basPack.buildBasPack(
      {
        income: [
          { date: "2026-08-15", amount: 1100 },
          { date: "2026-08-20", amount: 550, gstFree: true },
        ],
        expenses: [{ date: "2026-08-16", amount: 110, gstExempt: true }],
      },
      {
        name: "Alex Driver",
        tradingName: "Alex Haulage",
        abn: "51824753556",
        entityType: "sole_trader",
        gstRegistered: true,
        financialYear: "2026-27",
      },
      { financialYear: "2026-27", quarter: "q1" }
    );
    expect(pack.sales).toBe(1650);
    expect(pack.gstOnSales).toBe(100);
    expect(pack.purchases).toBe(110);
    expect(pack.gstOnPurchases).toBe(0);
    expect(pack.gstFreeSales).toBe(550);
    expect(pack.identity.abnFormatted).toBe("51 824 753 556");
    expect(pack.identity.name).toBe("Alex Driver");
  });

  it("rolls a weekend statutory due date to the next business day", () => {
    const due = basPack.periodForQuarter("q2", "2025-26");
    expect(due.statutoryDueDate).toBe("2026-02-28");
    expect(due.dueDate).toBe("2026-03-02");
    expect(due.dueDateRolled).toBe(true);
  });
});

describe("year compare", () => {
  it("builds a multi-year snapshot from summariseYear", () => {
    const pack = yearCompare.buildYearCompare(
      { income: [], expenses: [] },
      { financialYear: "2026-27" },
      {
        years: 3,
        now: new Date("2026-09-21T00:00:00Z"),
        summariseYear: (_records, profile) => ({
          financialYear: profile.financialYear,
          income: { assessableTotal: profile.financialYear === "2026-27" ? 90000 : 80000 },
          expenses: { deductibleTotal: 10000 },
          taxEstimate: { taxableIncome: 70000, estimatedTax: 15000 },
        }),
      }
    );
    expect(pack.years).toEqual(["2026-27", "2025-26", "2024-25"]);
    expect(pack.rows[0].assessableIncome).toBe(90000);
    expect(pack.previous.assessableIncome).toBe(80000);
  });
});

describe("accountant share", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "share-"));
    dataDir.setDataDirForTests(tmp);
  });
  afterEach(() => {
    dataDir.setDataDirForTests(null);
  });
  it("creates and looks up a live token", () => {
    const records = { profile: { financialYear: "2025-26" }, accountantShares: [] };
    const share = accountantShare.createShare({
      records,
      username: "alex",
      product: "suite",
      financialYear: "2025-26",
      createdBy: "alex",
    });
    expect(share.token).toHaveLength(48);
    expect(accountantShare.lookupShare(share.token).username).toBe("alex");
    accountantShare.revokeShare({ records, token: share.token });
    expect(accountantShare.lookupShare(share.token)).toBeNull();
  });
});

describe("billing Pro+ price ids", () => {
  it("uses Suite Pro+ Stripe price ids", () => {
    const prev = {
      STRIPE_PRICE_ID_SUITE_PLUS: process.env.STRIPE_PRICE_ID_SUITE_PLUS,
      STRIPE_PRICE_ID_SUITE_PLUS_YEARLY: process.env.STRIPE_PRICE_ID_SUITE_PLUS_YEARLY,
    };
    process.env.STRIPE_PRICE_ID_SUITE_PLUS = "price_suite_plus_month";
    process.env.STRIPE_PRICE_ID_SUITE_PLUS_YEARLY = "price_suite_plus_year";
    try {
      expect(configuredPriceId("suite", "month", "pro_plus")).toBe("price_suite_plus_month");
      expect(configuredPriceId("suite", "year", "pro_plus")).toBe("price_suite_plus_year");
      expect(configuredPriceId("suite", "month", "pro")).not.toBe("price_suite_plus_month");
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("stores subscriptionTier from Stripe metadata", () => {
    const user = { username: "alex", plan: "free" };
    applySubscriptionToUser(user, {
      id: "sub_plus",
      status: "active",
      metadata: { tier: "pro_plus" },
      current_period_end: Math.floor(new Date("2026-10-15T00:00:00Z").getTime() / 1000),
    });
    expect(user.subscriptionTier).toBe("pro_plus");
    expect(user.plan).toBe("pro");
  });
});
