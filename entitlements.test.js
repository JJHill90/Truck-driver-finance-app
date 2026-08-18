const {
  FREE_UPLOADS_PER_MONTH,
  FREE_ONSCREEN_REPORTS,
  FREE_SOFT_WARN_USED,
  PRO_PRICE_AUD,
  PRO_PRICE_YEARLY_AUD,
  TRIAL_MONTHS,
  TRIAL_PRODUCT_LABEL,
  addTrialEnd,
  countUploadsThisMonth,
  shouldSoftWarnUploads,
  trialOfferStatus,
  assignSignupTrial,
  applyAdminPlanGrant,
  isPro,
  ensureBillingFields,
  resolveEntitlements,
  trialExpired,
  trialEndingSoon,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
} = require("./lib/entitlements");

describe("entitlements", () => {
  it("locks Pro at $5/mo or $60/yr and a universal 3-month Pro+ trial", () => {
    expect(PRO_PRICE_AUD).toBe(5);
    expect(PRO_PRICE_YEARLY_AUD).toBe(60);
    expect(FREE_UPLOADS_PER_MONTH).toBe(15);
    expect(FREE_SOFT_WARN_USED).toBe(8);
    expect(FREE_ONSCREEN_REPORTS).toBe(1);
    expect(TRIAL_MONTHS).toBe(3);
    expect(TRIAL_PRODUCT_LABEL).toBe("Pro+");
    const offer = trialOfferStatus();
    expect(offer.open).toBe(true);
    expect(offer.universal).toBe(true);
    expect(offer.trialMonths).toBe(3);
    expect(offer.trialLabel).toBe("Pro+");
    expect(offer.priceYearlyLabel).toBe("$60/year");
  });

  it("soft-warns only after halfway free uploads, before the hard cap", () => {
    expect(shouldSoftWarnUploads(7, 8, false)).toBe(false);
    expect(shouldSoftWarnUploads(8, 7, false)).toBe(true);
    expect(shouldSoftWarnUploads(14, 1, false)).toBe(true);
    expect(shouldSoftWarnUploads(15, 0, false)).toBe(false);
    expect(shouldSoftWarnUploads(8, 7, true)).toBe(false);
  });

  it("falls back to Free 15 uploads + 1 on-screen report after Pro+ ends", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const afterTrial = resolveEntitlements(
      {
        plan: "free",
        proTrialEndsAt: "2026-11-01T00:00:00Z",
      },
      { receipts: [] },
      now
    );
    expect(afterTrial.isPro).toBe(false);
    expect(afterTrial.trialExpired).toBe(true);
    expect(afterTrial.uploadsLimit).toBe(15);
    expect(afterTrial.canUpload).toBe(true);
    expect(afterTrial.canViewOnScreenReport).toBe(true);
    expect(afterTrial.freeOnscreenReports).toBe(1);
    expect(afterTrial.canExportPdf).toBe(false);
    expect(afterTrial.canUseForecast).toBe(false);
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
    const beforeHalf = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      createdAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const early = resolveEntitlements(
      { plan: "free", proTrialEndsAt: null },
      { receipts: beforeHalf },
      now
    );
    expect(early.uploadsUsed).toBe(7);
    expect(early.softWarning).toBe(false);

    const receipts = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      createdAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const free = resolveEntitlements(
      { plan: "free", proTrialEndsAt: null },
      { receipts },
      now
    );
    expect(free.isPro).toBe(false);
    expect(free.uploadsUsed).toBe(8);
    expect(free.uploadsRemaining).toBe(7);
    expect(free.canUpload).toBe(true);
    expect(free.softWarning).toBe(true);
    expect(free.canExportPdf).toBe(false);
    expect(free.canUseForecast).toBe(false);
    expect(free.priceAud).toBe(5);
    expect(free.priceYearlyAud).toBe(60);
    expect(free.trialMonths).toBe(3);
    expect(free.trialLabel).toBe("Pro+");

    const atLimit = resolveEntitlements(
      { plan: "free", proTrialEndsAt: null },
      {
        receipts: Array.from({ length: 15 }, (_, i) => ({
          id: String(i),
          createdAt: `2026-08-${String(Math.min(i + 1, 15)).padStart(2, "0")}T00:00:00Z`,
        })),
      },
      now
    );
    expect(atLimit.canUpload).toBe(false);
    expect(atLimit.uploadsRemaining).toBe(0);
    expect(atLimit.softWarning).toBe(false);

    const blocked = uploadBlockedPayload(atLimit);
    expect(blocked.code).toBe("UPLOAD_LIMIT");
    expect(blocked.error).toMatch(/\$5\/month/);
    expect(blocked.error).toMatch(/\$60\/year/);

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

  it("lets admin upgrade Free → Pro+ and downgrade back to Free whenever", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const user = {
      username: "dave",
      isAdmin: false,
      plan: "free",
      proTrialEndsAt: "2026-05-01T00:00:00Z",
    };
    expect(isPro(user, now)).toBe(false);

    applyAdminPlanGrant(user, "pro_plus", { by: "Haulage_Admin", at: now.toISOString() });
    expect(user.planGrant).toBe("pro_plus");
    expect(isPro(user, now)).toBe(true);
    const up = resolveEntitlements(user, { receipts: [] }, now);
    expect(up.status).toBe("pro_plus");
    expect(up.planGrant).toBe("pro_plus");
    expect(up.canExportPdf).toBe(true);

    applyAdminPlanGrant(user, "free", { by: "Haulage_Admin", at: now.toISOString() });
    expect(user.planGrant).toBe("free");
    expect(user.plan).toBe("free");
    expect(isPro(user, now)).toBe(false);
    const down = resolveEntitlements(user, { receipts: [] }, now);
    expect(down.status).toBe("free");
    expect(down.planGrant).toBe("free");
    expect(down.canExportPdf).toBe(false);

    expect(() => applyAdminPlanGrant({ isAdmin: true }, "pro_plus")).toThrow(/Primary mod/);
  });

  it("admin Free grant overrides an open trial until upgraded again", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const user = {
      username: "sam",
      isAdmin: false,
      proTrialEndsAt: addTrialEnd("2026-08-01T00:00:00Z"),
    };
    expect(isPro(user, now)).toBe(true);
    applyAdminPlanGrant(user, "free", { by: "Haulage_Admin", at: now.toISOString() });
    expect(isPro(user, now)).toBe(false);
    expect(new Date(user.proTrialEndsAt).getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("maps Free / Pro / Pro+ displayPlan for hub badges", () => {
    const { displayPlanTier } = require("./lib/entitlements");
    const now = new Date("2026-08-15T12:00:00Z");
    expect(displayPlanTier({ plan: "free" }, now)).toBe("Free");
    expect(displayPlanTier({ isAdmin: true }, now)).toBe("Pro");
    expect(
      displayPlanTier(
        { subscriptionStatus: "active", currentPeriodEnd: "2026-09-15T00:00:00Z" },
        now
      )
    ).toBe("Pro");
    expect(
      displayPlanTier({ planGrant: "pro_plus", plan: "pro" }, now)
    ).toBe("Pro+");
    expect(
      displayPlanTier(
        { proTrialEndsAt: addTrialEnd("2026-08-01T00:00:00Z") },
        now
      )
    ).toBe("Pro+");

    const paid = resolveEntitlements(
      {
        subscriptionStatus: "active",
        stripeSubscriptionId: "sub_x",
        currentPeriodEnd: "2026-09-15T00:00:00Z",
        cancelAtPeriodEnd: true,
      },
      { receipts: [] },
      now
    );
    expect(paid.displayPlan).toBe("Pro");
    expect(paid.cancelAtPeriodEnd).toBe(true);
    expect(paid.hasStripeSubscription).toBe(true);
  });
});
