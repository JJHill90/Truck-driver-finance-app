const {
  FREE_UPLOADS_PER_MONTH,
  PRO_PRICE_AUD,
  addTrialEnd,
  countUploadsThisMonth,
  isPro,
  ensureBillingFields,
  resolveEntitlements,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
} = require("./lib/entitlements");

describe("entitlements", () => {
  it("locks Pro at $5 AUD", () => {
    expect(PRO_PRICE_AUD).toBe(5);
    expect(FREE_UPLOADS_PER_MONTH).toBe(15);
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

  it("backfills a fresh trial for legacy users missing proTrialEndsAt", () => {
    const user = { username: "legacy", createdAt: "2020-01-01T00:00:00Z" };
    expect(ensureBillingFields(user)).toBe(true);
    expect(user.proTrialEndsAt).toBeTruthy();
    expect(new Date(user.proTrialEndsAt).getTime()).toBeGreaterThan(Date.now());
    expect(user.plan).toBe("free");
  });

  it("enforces the free upload quota and soft warning", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const receipts = Array.from({ length: 13 }, (_, i) => ({
      id: String(i),
      createdAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const free = resolveEntitlements(
      { plan: "free", proTrialEndsAt: "2020-01-01T00:00:00Z" },
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

    const atLimit = resolveEntitlements(
      { plan: "free", proTrialEndsAt: "2020-01-01T00:00:00Z" },
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
