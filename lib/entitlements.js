/**
 * Freemium entitlements for Taxation Hub (Driver Hub billing).
 *
 * Free: 15 document uploads / calendar month + 1 on-screen EOFY report
 * (live /summary + /report in the app). PDF/JSON export and forecast are Pro.
 * New driver profiles start on Free. They pay for Pro or Pro+, or the primary
 * mod grants complimentary Pro+.
 * Pro: unlimited uploads, PDF + accountant export, forecast. Local OCR.
 *   Taxation Hub / Driver Hub: $5/mo or $60/yr.
 *   Go Taxation Suite: $10/mo or $110/yr (two months free vs 12 × $10).
 * Pro+ is a real extra tier (not another badge on Pro):
 *   accountant share link, extra entity, partnership seat, BAS/GST pack,
 *   cloud OCR, multi-year tax pack, priority support.
 *   Suite paid Pro+: $18/mo or $190/yr.
 *   Complimentary Pro+ still comes from `planGrant`. Leftover signup trials
 *   keep Pro features only — they do not unlock the new Pro+ extras.
 * Primary mod is always Pro+ and may grant or revoke Pro+ / Free via `planGrant`.
 */
const FREE_UPLOADS_PER_MONTH = 15;
/** On-screen EOFY report included with Free (PDF download remains Pro). */
const FREE_ONSCREEN_REPORTS = 1;
/** Soft Pro+ upgrade prompt once the driver has used this many free uploads. */
const FREE_SOFT_WARN_USED = Math.ceil(FREE_UPLOADS_PER_MONTH / 2);
const PRO_PRICE_AUD = 5;
const PRO_PRICE_LABEL = "$5/month";
const PRO_PRICE_YEARLY_AUD = 60;
const PRO_PRICE_YEARLY_LABEL = "$60/year";
const SUITE_PRO_PRICE_AUD = 10;
const SUITE_PRO_PRICE_LABEL = "$10/month";
const SUITE_PRO_PRICE_YEARLY_AUD = 110;
const SUITE_PRO_PRICE_YEARLY_LABEL = "$110/year";
const SUITE_PRO_PLUS_PRICE_AUD = 18;
const SUITE_PRO_PLUS_PRICE_LABEL = "$18/month";
const SUITE_PRO_PLUS_PRICE_YEARLY_AUD = 190;
const SUITE_PRO_PLUS_PRICE_YEARLY_LABEL = "$190/year";
const SUBSCRIPTION_TIER_PRO = "pro";
const SUBSCRIPTION_TIER_PRO_PLUS = "pro_plus";
const TRIAL_MONTHS = 3;
/** Marketing label for the signup trial (same entitlements as Pro). */
const TRIAL_PRODUCT_LABEL = "Pro+";
/** Soft alert window before trial end (days). */
const TRIAL_ENDING_SOON_DAYS = 14;
/** Admin complimentary / forced plan values on `user.planGrant`. */
const PLAN_GRANT_PRO_PLUS = "pro_plus";
const PLAN_GRANT_FREE = "free";
const PLAN_GRANT_VALUES = new Set([PLAN_GRANT_PRO_PLUS, PLAN_GRANT_FREE]);

function trialMs() {
  // ~91 days — stable enough for “3 months”
  return TRIAL_MONTHS * 30.44 * 24 * 60 * 60 * 1000;
}

function addTrialEnd(fromIso = new Date().toISOString()) {
  const start = new Date(fromIso).getTime();
  const base = Number.isFinite(start) ? start : Date.now();
  return new Date(base + trialMs()).toISOString();
}

function monthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function receiptCreatedAt(receipt) {
  return (
    receipt.createdAt ||
    receipt.uploadedAt ||
    receipt.confirmedAt ||
    receipt.date ||
    null
  );
}

/** Count file/document uploads in the current calendar month. */
function countUploadsThisMonth(records, now = new Date()) {
  const key = monthKey(now);
  const list = (records && records.receipts) || [];
  let n = 0;
  for (const r of list) {
    const raw = receiptCreatedAt(r);
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (monthKey(d) === key) n += 1;
  }
  return n;
}

function normalizeBillingProduct(product) {
  const p = String(product || "").toLowerCase();
  return p === "suite" || p === "gotax" ? "suite" : "haulage";
}

/** Display prices for the product the driver is on. Suite is not Driver Hub. */
function normalizeSubscriptionTier(user) {
  const t = String((user && user.subscriptionTier) || "").toLowerCase().replace(/\+/g, "_plus");
  return t === SUBSCRIPTION_TIER_PRO_PLUS ? SUBSCRIPTION_TIER_PRO_PLUS : SUBSCRIPTION_TIER_PRO;
}

function normalizeCheckoutPlan(plan) {
  const p = String(plan || "pro")
    .toLowerCase()
    .replace(/\+/g, "_plus")
    .replace(/[\s-]+/g, "_");
  return p === "pro_plus" || p === "plus" ? SUBSCRIPTION_TIER_PRO_PLUS : SUBSCRIPTION_TIER_PRO;
}

function pricingForProduct(product) {
  if (normalizeBillingProduct(product) === "suite") {
    return {
      product: "suite",
      productName: "Go Taxation Suite",
      priceAud: SUITE_PRO_PRICE_AUD,
      priceLabel: SUITE_PRO_PRICE_LABEL,
      priceYearlyAud: SUITE_PRO_PRICE_YEARLY_AUD,
      priceYearlyLabel: SUITE_PRO_PRICE_YEARLY_LABEL,
      plusPriceAud: SUITE_PRO_PLUS_PRICE_AUD,
      plusPriceLabel: SUITE_PRO_PLUS_PRICE_LABEL,
      plusPriceYearlyAud: SUITE_PRO_PLUS_PRICE_YEARLY_AUD,
      plusPriceYearlyLabel: SUITE_PRO_PLUS_PRICE_YEARLY_LABEL,
    };
  }
  return {
    product: "haulage",
    productName: "Taxation Hub",
    priceAud: PRO_PRICE_AUD,
    priceLabel: PRO_PRICE_LABEL,
    priceYearlyAud: PRO_PRICE_YEARLY_AUD,
    priceYearlyLabel: PRO_PRICE_YEARLY_LABEL,
    plusPriceAud: null,
    plusPriceLabel: null,
    plusPriceYearlyAud: null,
    plusPriceYearlyLabel: null,
  };
}

/**
 * Public signup copy — new profiles start on Free (no automatic trial).
 */
function trialOfferStatus(product) {
  const prices = pricingForProduct(product);
  return {
    trialMonths: 0,
    trialLabel: TRIAL_PRODUCT_LABEL,
    priceLabel: prices.priceLabel,
    priceAud: prices.priceAud,
    priceYearlyAud: prices.priceYearlyAud,
    priceYearlyLabel: prices.priceYearlyLabel,
    open: false,
    universal: false,
    startsOn: "free",
    freeUploadsPerMonth: FREE_UPLOADS_PER_MONTH,
    freeOnscreenReports: FREE_ONSCREEN_REPORTS,
    product: prices.product,
    productName: prices.productName,
    plusPriceAud: prices.plusPriceAud,
    plusPriceLabel: prices.plusPriceLabel,
    plusPriceYearlyAud: prices.plusPriceYearlyAud,
    plusPriceYearlyLabel: prices.plusPriceYearlyLabel,
  };
}

/** True once free uploads hit halfway (and before the hard monthly cap). */
function shouldSoftWarnUploads(used, remaining, isProUser) {
  if (isProUser) return false;
  if (remaining == null || remaining <= 0) return false;
  return Number(used) >= FREE_SOFT_WARN_USED;
}

/** @deprecated Alias of trialOfferStatus (kept for older clients). */
function foundingStatus() {
  return trialOfferStatus();
}

/**
 * New profiles start on Free. Kept as a no-op so leftover callers cannot
 * re-enable the old automatic Pro+ trial. Existing `proTrialEndsAt` dates
 * still honour a complimentary trial until it expires or admin grants a plan.
 * @returns {boolean} always false
 */
function assignSignupTrial(user) {
  if (!user) return false;
  if (user.isAdmin && user.proTrialEndsAt == null) user.proTrialEndsAt = null;
  return false;
}

/** @deprecated Use assignSignupTrial. */
function assignFoundingTrial(user) {
  return assignSignupTrial(user);
}

function subscriptionActive(user, now = new Date()) {
  if (!user) return false;
  const status = String(user.subscriptionStatus || "").toLowerCase();
  if (!["active", "trialing"].includes(status)) return false;
  if (user.currentPeriodEnd) {
    const end = new Date(user.currentPeriodEnd).getTime();
    if (Number.isFinite(end) && end < now.getTime()) return false;
  }
  return true;
}

function trialActive(user, now = new Date()) {
  if (!user || !user.proTrialEndsAt) return false;
  const end = new Date(user.proTrialEndsAt).getTime();
  return Number.isFinite(end) && end > now.getTime();
}

function normalisedPlanGrant(user) {
  if (!user) return null;
  const g = String(user.planGrant || "").toLowerCase();
  return PLAN_GRANT_VALUES.has(g) ? g : null;
}

function hasProPlusGrant(user) {
  return normalisedPlanGrant(user) === PLAN_GRANT_PRO_PLUS;
}

function hasForcedFreeGrant(user) {
  return normalisedPlanGrant(user) === PLAN_GRANT_FREE;
}

/**
 * Primary mod sets Free or Pro+ on a driver. Mutates `user`.
 * @param {"pro_plus"|"free"} grant
 * @param {{ by?: string, at?: string }} [meta]
 */
function applyAdminPlanGrant(user, grant, meta = {}) {
  if (!user) throw new Error("User required.");
  if (user.isAdmin) throw new Error("Primary mod plan cannot be changed.");
  const next = String(grant || "").toLowerCase();
  if (!PLAN_GRANT_VALUES.has(next)) {
    throw new Error('Plan must be "pro_plus" or "free".');
  }
  const at = meta.at || new Date().toISOString();
  user.planGrant = next;
  user.planGrantedAt = at;
  user.planGrantedBy = meta.by || null;
  if (next === PLAN_GRANT_PRO_PLUS) {
    user.plan = "pro";
  } else {
    user.plan = "free";
    // End any open signup trial so Free takes effect immediately.
    if (trialActive(user, new Date(at))) {
      user.proTrialEndsAt = at;
    }
    // Clear local Stripe-derived Pro flags so admin Free wins in-app.
    // (Stripe Customer Portal / webhooks may re-activate paid Pro later.)
    if (subscriptionActive(user, new Date(at))) {
      user.subscriptionStatus = "canceled";
      user.currentPeriodEnd = null;
    }
  }
  return user;
}

/** Clear a forced-Free grant when a paid Stripe subscription becomes active. */
function clearForcedFreeGrantOnPaid(user) {
  if (!user || !hasForcedFreeGrant(user)) return false;
  user.planGrant = null;
  user.planGrantedAt = null;
  user.planGrantedBy = null;
  return true;
}

/** Had a trial that has ended, and is not on a paid/admin plan. */
function trialExpired(user, now = new Date()) {
  if (!user || user.isAdmin || subscriptionActive(user, now) || hasProPlusGrant(user)) return false;
  if (hasForcedFreeGrant(user)) return false;
  if (!user.proTrialEndsAt) return false;
  const end = new Date(user.proTrialEndsAt).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

/** Trial still active and ending within TRIAL_ENDING_SOON_DAYS. */
function trialEndingSoon(user, now = new Date()) {
  if (
    !trialActive(user, now) ||
    subscriptionActive(user, now) ||
    (user && user.isAdmin) ||
    hasProPlusGrant(user) ||
    hasForcedFreeGrant(user)
  ) {
    return false;
  }
  const end = new Date(user.proTrialEndsAt).getTime();
  const msLeft = end - now.getTime();
  return msLeft > 0 && msLeft <= TRIAL_ENDING_SOON_DAYS * 24 * 60 * 60 * 1000;
}

function isPro(user, now = new Date()) {
  if (!user) return false;
  if (user.isAdmin) return true;
  // Admin force Free / Pro+ overrides trial and local subscription flags.
  if (hasForcedFreeGrant(user)) return false;
  if (hasProPlusGrant(user)) return true;
  if (subscriptionActive(user, now)) return true;
  if (trialActive(user, now)) return true;
  return false;
}

/**
 * Paid or granted Pro+ extras. Leftover signup trials are Pro-only.
 */
function isProPlus(user, now = new Date()) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (hasForcedFreeGrant(user)) return false;
  if (hasProPlusGrant(user)) return true;
  return (
    subscriptionActive(user, now) &&
    normalizeSubscriptionTier(user) === SUBSCRIPTION_TIER_PRO_PLUS
  );
}

/**
 * Short UI label for hub badges / profile chips: Free | Pro | Pro+.
 * Pro+ = paid Pro+ subscription or admin grant. Leftover signup trials still
 * show Pro+ (historical label) but do not unlock Pro+ extras.
 */
function displayPlanTier(user, now = new Date()) {
  if (!user) return "Free";
  if (user.isAdmin) return "Pro";
  if (hasForcedFreeGrant(user)) return "Free";
  if (hasProPlusGrant(user)) return TRIAL_PRODUCT_LABEL;
  if (subscriptionActive(user, now) && normalizeSubscriptionTier(user) === SUBSCRIPTION_TIER_PRO_PLUS) {
    return TRIAL_PRODUCT_LABEL;
  }
  if (
    trialActive(user, now) &&
    !subscriptionActive(user, now)
  ) {
    return TRIAL_PRODUCT_LABEL;
  }
  if (subscriptionActive(user, now) || isPro(user, now)) return "Pro";
  return "Free";
}

/**
 * Ensure durable billing fields exist. Does NOT invent trials.
 * @returns {boolean} true if the record was mutated
 */
function ensureBillingFields(user) {
  if (!user) return false;
  let dirty = false;
  if (user.plan == null) {
    user.plan = "free";
    dirty = true;
  }
  if (user.planGrant !== undefined && user.planGrant !== null) {
    const g = String(user.planGrant || "").toLowerCase();
    if (g && !PLAN_GRANT_VALUES.has(g)) {
      user.planGrant = null;
      dirty = true;
    } else if (user.planGrant !== g && PLAN_GRANT_VALUES.has(g)) {
      user.planGrant = g;
      dirty = true;
    }
  }
  return dirty;
}

function resolveEntitlements(user, records = null, now = new Date(), opts = {}) {
  const pro = isPro(user, now);
  const used = countUploadsThisMonth(records, now);
  const limit = pro ? null : FREE_UPLOADS_PER_MONTH;
  const remaining = pro ? null : Math.max(0, FREE_UPLOADS_PER_MONTH - used);
  const grant = normalisedPlanGrant(user);
  const trial =
    trialActive(user, now) &&
    !subscriptionActive(user, now) &&
    !hasProPlusGrant(user) &&
    !hasForcedFreeGrant(user);
  let status = "free";
  if (user && user.isAdmin) status = "admin";
  else if (grant === PLAN_GRANT_PRO_PLUS) status = "pro_plus";
  else if (grant === PLAN_GRANT_FREE) status = "free";
  else if (subscriptionActive(user, now)) status = String(user.subscriptionStatus || "active");
  else if (trial) status = "trialing";

  const cancelAtPeriodEnd = Boolean(user && user.cancelAtPeriodEnd);
  const hasStripeSubscription = Boolean(user && user.stripeSubscriptionId);
  const plus = isProPlus(user, now);
  const subscriptionTier = plus
    ? SUBSCRIPTION_TIER_PRO_PLUS
    : pro
      ? SUBSCRIPTION_TIER_PRO
      : "free";
  // Driver Hub Taxation keeps EOFY accountant packs on Pro (same $5/$60 price).
  // Go Taxation Suite still gates those packs behind paid/granted Pro+.
  const product = String(opts.product || "haulage").toLowerCase();
  const eofyPacksUnlocked = product === "suite" ? plus : pro;

  return {
    plan: pro ? "pro" : "free",
    displayPlan: displayPlanTier(user, now),
    status,
    isPro: pro,
    isProPlus: plus,
    subscriptionTier,
    isAdmin: Boolean(user && user.isAdmin),
    planGrant: grant,
    planGrantedAt: (user && user.planGrantedAt) || null,
    planGrantedBy: (user && user.planGrantedBy) || null,
    trialLabel: TRIAL_PRODUCT_LABEL,
    trialEndsAt: (user && user.proTrialEndsAt) || null,
    trialExpired: trialExpired(user, now),
    trialEndingSoon: trialEndingSoon(user, now),
    currentPeriodEnd: (user && user.currentPeriodEnd) || null,
    subscriptionStatus: (user && user.subscriptionStatus) || null,
    subscriptionInterval: (user && user.subscriptionInterval) || null,
    cancelAtPeriodEnd,
    hasStripeSubscription,
    hasStripeCustomer: Boolean(user && user.stripeCustomerId),
    uploadsUsed: used,
    uploadsLimit: limit,
    uploadsRemaining: remaining,
    uploadsMonthKey: monthKey(now),
    canUpload: pro || used < FREE_UPLOADS_PER_MONTH,
    /** Free always includes the live on-screen EOFY report; PDF is Pro-only. */
    canViewOnScreenReport: true,
    freeOnscreenReports: FREE_ONSCREEN_REPORTS,
    canExportPdf: pro,
    canExportJson: pro,
    canUseForecast: pro,
    canCloudOcr: plus,
    canShareAccountant: eofyPacksUnlocked,
    canExtraEntity: plus,
    canPartnershipSeat: plus,
    canBasPack: eofyPacksUnlocked,
    canYearCompare: eofyPacksUnlocked,
    canPrioritySupport: plus,
    ...pricingForProduct(opts.product),
    freeUploadsPerMonth: FREE_UPLOADS_PER_MONTH,
    softWarnAtUsed: FREE_SOFT_WARN_USED,
    trialMonths: TRIAL_MONTHS,
    softWarning: shouldSoftWarnUploads(used, remaining, pro),
  };
}

function uploadBlockedPayload(entitlements) {
  const prices = pricingForProduct(entitlements && entitlements.product);
  return {
    error: `Free plan includes ${FREE_UPLOADS_PER_MONTH} uploads per month and ${FREE_ONSCREEN_REPORTS} on-screen EOFY report. Upgrade to Pro (${prices.priceLabel} or ${prices.priceYearlyLabel}) for unlimited scans and PDF reports.`,
    code: "UPLOAD_LIMIT",
    entitlements,
  };
}

function proFeatureBlockedPayload(feature, entitlements) {
  const prices = pricingForProduct(entitlements && entitlements.product);
  const labels = {
    pdf: "PDF export",
    json: "JSON accountant export",
    forecast: "Forecast",
  };
  const label = labels[feature] || "This feature";
  return {
    error: `${label} is included with Pro (${prices.priceLabel} or ${prices.priceYearlyLabel}). You’re on the free plan — upgrade to unlock.`,
    code: "PRO_REQUIRED",
    feature,
    entitlements,
  };
}

function proPlusFeatureBlockedPayload(feature, entitlements) {
  const prices = pricingForProduct(entitlements && entitlements.product);
  const labels = {
    share: "Accountant share links",
    extra_entity: "An extra taxpayer entity",
    partnership: "A partnership seat",
    bas: "BAS / GST quarterly packs",
    ocr: "Cloud OCR",
    year_compare: "Multi-year tax packs",
    support: "Priority support",
  };
  const label = labels[feature] || "This feature";
  const plusPrice =
    prices.plusPriceLabel && prices.plusPriceYearlyLabel
      ? `${prices.plusPriceLabel} or ${prices.plusPriceYearlyLabel}`
      : "Pro+";
  return {
    error: `${label} is included with Pro+ (${plusPrice}). Local OCR, unlimited uploads and PDF export stay on Pro.`,
    code: "PRO_PLUS_REQUIRED",
    feature,
    entitlements,
  };
}

module.exports = {
  FREE_UPLOADS_PER_MONTH,
  FREE_ONSCREEN_REPORTS,
  FREE_SOFT_WARN_USED,
  PRO_PRICE_AUD,
  PRO_PRICE_LABEL,
  PRO_PRICE_YEARLY_AUD,
  PRO_PRICE_YEARLY_LABEL,
  SUITE_PRO_PRICE_AUD,
  SUITE_PRO_PRICE_LABEL,
  SUITE_PRO_PRICE_YEARLY_AUD,
  SUITE_PRO_PRICE_YEARLY_LABEL,
  SUITE_PRO_PLUS_PRICE_AUD,
  SUITE_PRO_PLUS_PRICE_LABEL,
  SUITE_PRO_PLUS_PRICE_YEARLY_AUD,
  SUITE_PRO_PLUS_PRICE_YEARLY_LABEL,
  SUBSCRIPTION_TIER_PRO,
  SUBSCRIPTION_TIER_PRO_PLUS,
  normalizeBillingProduct,
  normalizeSubscriptionTier,
  normalizeCheckoutPlan,
  pricingForProduct,
  TRIAL_MONTHS,
  TRIAL_PRODUCT_LABEL,
  TRIAL_ENDING_SOON_DAYS,
  PLAN_GRANT_PRO_PLUS,
  PLAN_GRANT_FREE,
  addTrialEnd,
  monthKey,
  countUploadsThisMonth,
  shouldSoftWarnUploads,
  trialOfferStatus,
  foundingStatus,
  assignSignupTrial,
  assignFoundingTrial,
  subscriptionActive,
  trialActive,
  trialExpired,
  trialEndingSoon,
  normalisedPlanGrant,
  hasProPlusGrant,
  hasForcedFreeGrant,
  applyAdminPlanGrant,
  clearForcedFreeGrantOnPaid,
  isPro,
  isProPlus,
  displayPlanTier,
  ensureBillingFields,
  resolveEntitlements,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
  proPlusFeatureBlockedPayload,
};
