const {
  FREE_UPLOADS_PER_MONTH,
  PRO_PRICE_AUD,
  TRIAL_MONTHS,
  TRIAL_PRODUCT_LABEL,
  addTrialEnd,
  countUploadsThisMonth,
  trialOfferStatus,
  assignSignupTrial,
  isPro,
  ensureBillingFields,
  resolveEntitlements,
  trialExpired,
  trialEndingSoon,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
} = require("./lib/entitlements");

describe("entitlements", () => {
  it("locks Pro at $5 AUD and a universal 3-month Pro+ trial", () => {
    expect(PRO_PRICE_AUD).toBe(5);
    expect(FREE_UPLOADS_PER_MONTH).toBe(15);
    expect(TRIAL_MONTHS).toBe(3);
    expect(TRIAL_PRODUCT_LABEL).toBe("Pro+");
    const offer = trialOfferStatus();
    expect(offer.open).toBe(true);
    expect(offer.universal).toBe(true);
    expect(offer.trialMonths).toBe(3);
    expect(offer.trialLabel).toBe("Pro+");
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

  it("does not invent trials for existing users missing proTrialEndsAt", () => {
    const user = { username: "existing", createdAt: "2020-01-01T00:00:00Z" };
    expect(ensureBillingFields(user)).toBe(true);
    expect(user.proTrialEndsAt).toBeUndefined();
    expect(user.plan).toBe("free");
    expect(isPro(user)).toBe(false);
  });

  it("assigns a Pro+ trial to every new non-admin signup", () => {
    const driver = { username: "dave", createdAt: "2026-08-12T00:00:00Z", isAdmin: false };
    expect(assignSignupTrial(driver)).toBe(true);
    expect(driver.proTrialEndsAt).toBeTruthy();
    expect(isPro(driver, new Date("2026-08-12"))).toBe(true);
    expect(isPro(driver, new Date("2026-12-01"))).toBe(false);

    // Idempotent — does not overwrite an existing end date.
    const prior = driver.proTrialEndsAt;
    expect(assignSignupTrial(driver)).toBe(false);
    expect(driver.proTrialEndsAt).toBe(prior);

    const admin = { username: "admin", isAdmin: true };
    expect(assignSignupTrial(admin)).toBe(false);
    expect(admin.proTrialEndsAt).toBeNull();
    expect(isPro(admin)).toBe(true);
  });

  it("flags trial ending soon and trial expired for soft alerts", () => {
    const now = new Date("2026-08-12T12:00:00Z");
    const ending = {
      proTrialEndsAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(trialEndingSoon(ending, now)).toBe(true);
    expect(trialExpired(ending, now)).toBe(false);

    const ended = { proTrialEndsAt: "2026-05-01T00:00:00Z" };
    expect(trialExpired(ended, now)).toBe(true);
    expect(trialEndingSoon(ended, now)).toBe(false);

    const paid = {
      proTrialEndsAt: "2026-05-01T00:00:00Z",
      subscriptionStatus: "active",
    };
    expect(trialExpired(paid, now)).toBe(false);
  });

  it("enforces the free upload quota and soft warning", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const receipts = Array.from({ length: 13 }, (_, i) => ({
      id: String(i),
      createdAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const free = resolveEntitlements(
      { plan: "free", proTrialEndsAt: null },
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
    expect(free.trialMonths).toBe(3);
    expect(free.trialLabel).toBe("Pro+");

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
