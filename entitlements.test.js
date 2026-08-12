const {
  FREE_UPLOADS_PER_MONTH,
  PRO_PRICE_AUD,
  FOUNDING_TRIAL_LIMIT,
  addTrialEnd,
  countUploadsThisMonth,
  countFoundingCohort,
  foundingStatus,
  assignFoundingTrial,
  isPro,
  ensureBillingFields,
  resolveEntitlements,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
} = require("./lib/entitlements");

describe("entitlements", () => {
  it("locks Pro at $5 AUD and founding cohort at 50", () => {
    expect(PRO_PRICE_AUD).toBe(5);
    expect(FREE_UPLOADS_PER_MONTH).toBe(15);
    expect(FOUNDING_TRIAL_LIMIT).toBe(50);
  });

  it("counts uploads in the current calendar month only", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const records = {
      receipts: [
        { id: "1", createdAt: "2026-08-01T00:00:00Z" },
        { id: "2", createdAt: "2026-08-14T00:00:00Z" },
        { id: "3", createdAt: "2026-07-31T00:00:00Z" },
        { id: "4", uploadedAt: "2026-08-10T00:00:00Z" },
      ],
    };
    expect(countUploadsThisMonth(records, now)).toBe(3);
  });

  it("treats admin, active subscription and open trial as Pro", () => {
    expect(isPro({ isAdmin: true })).toBe(true);
    expect(isPro({ subscriptionStatus: "active" })).toBe(true);
    expect(isPro({ subscriptionStatus: "trialing" })).toBe(true);
    expect(
      isPro({ proTrialEndsAt: addTrialEnd("2026-01-01T00:00:00Z") }, new Date("2026-02-01"))
    ).toBe(true);
    expect(
      isPro({ proTrialEndsAt: "2025-01-01T00:00:00Z" }, new Date("2026-08-01"))
    ).toBe(false);
    expect(isPro({ plan: "free" })).toBe(false);
  });

  it("does not invent trials for legacy users missing proTrialEndsAt", () => {
    const user = { username: "legacy", createdAt: "2020-01-01T00:00:00Z" };
    expect(ensureBillingFields(user)).toBe(true);
    expect(user.proTrialEndsAt).toBeUndefined();
    expect(user.foundingCohort).toBe(false);
    expect(user.plan).toBe("free");
    expect(isPro(user)).toBe(false);
  });

  it("assigns founding trials only while slots remain", () => {
    const existing = {};
    for (let i = 0; i < FOUNDING_TRIAL_LIMIT; i += 1) {
      existing[`u${i}`] = {
        username: `u${i}`,
        foundingCohort: true,
        foundingSlot: i + 1,
        isAdmin: false,
      };
    }
    expect(countFoundingCohort({ users: existing })).toBe(50);
    expect(foundingStatus({ users: existing }).remaining).toBe(0);
    expect(foundingStatus({ users: existing }).open).toBe(false);

    const next = { username: "late", createdAt: "2026-08-12T00:00:00Z", isAdmin: false };
    expect(assignFoundingTrial(next, { users: existing })).toBe(false);
    expect(next.foundingCohort).toBe(false);
    expect(next.proTrialEndsAt).toBeNull();

    const early = { username: "early", createdAt: "2026-08-12T00:00:00Z", isAdmin: false };
    expect(assignFoundingTrial(early, { users: {} })).toBe(true);
    expect(early.foundingCohort).toBe(true);
    expect(early.foundingSlot).toBe(1);
    expect(early.proTrialEndsAt).toBeTruthy();
    expect(isPro(early)).toBe(true);

    const admin = { username: "admin", isAdmin: true };
    expect(assignFoundingTrial(admin, { users: {} })).toBe(false);
    expect(admin.foundingCohort).toBe(false);
  });

  it("enforces the free upload quota and soft warning", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const receipts = Array.from({ length: 13 }, (_, i) => ({
      id: String(i),
      createdAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const free = resolveEntitlements(
      { plan: "free", proTrialEndsAt: null, foundingCohort: false },
      { receipts },
      now
    );
    expect(free.isPro).toBe(false);
    expect(free.uploadsUsed).toBe(13);
    expect(free.uploadsRemaining).toBe(2);
    expect(free.canUpload).toBe(true);
    expect(free.softWarning).toBe(true);
    expect(free.canExportPdf).toBe(false);
    expect(free.canUseForecast).toBe(false);
    expect(free.priceAud).toBe(5);
    expect(free.foundingTrialLimit).toBe(50);

    const atLimit = resolveEntitlements(
      { plan: "free", proTrialEndsAt: null },
      {
        receipts: [
          ...receipts,
          { id: "a", createdAt: "2026-08-14T00:00:00Z" },
          { id: "b", createdAt: "2026-08-15T00:00:00Z" },
        ],
      },
      now
    );
    expect(atLimit.canUpload).toBe(false);
    expect(atLimit.uploadsRemaining).toBe(0);

    const blocked = uploadBlockedPayload(atLimit);
    expect(blocked.code).toBe("UPLOAD_LIMIT");
    expect(blocked.error).toMatch(/\$5\/month/);

    const proBlocked = proFeatureBlockedPayload("pdf", free);
    expect(proBlocked.code).toBe("PRO_REQUIRED");
    expect(proBlocked.feature).toBe("pdf");
  });

  it("gives Pro unlimited uploads and export flags", () => {
    const ent = resolveEntitlements(
      { isAdmin: true },
      { receipts: Array.from({ length: 40 }, (_, i) => ({ id: String(i), createdAt: "2026-08-01T00:00:00Z" })) },
      new Date("2026-08-15")
    );
    expect(ent.isPro).toBe(true);
    expect(ent.canUpload).toBe(true);
    expect(ent.uploadsLimit).toBeNull();
    expect(ent.canExportPdf).toBe(true);
    expect(ent.canExportJson).toBe(true);
    expect(ent.canUseForecast).toBe(true);
  });
});
