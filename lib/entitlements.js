/**
 * Freemium entitlements for Taxation Hub (Driver Hub billing).
 *
 * Free: 15 document uploads / calendar month + 1 on-screen EOFY report
 * (live /summary + /report in the app). PDF/JSON export and forecast are Pro.
 * Pro ($5/mo): unlimited uploads, PDF + accountant export, forecast.
 * Every new driver signup gets 3 months Pro+ trial (full Pro entitlements).
 * Users may subscribe from day 1; after the trial ends they fall back to the
 * Free limits (15 uploads + 1 on-screen report) until they choose a paid plan.
 * Primary mod is always Pro (no trial) and may grant/revoke Pro+ on any driver
 * via `planGrant` (`pro_plus` | `free` | null) at any time.
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

/**
 * Public signup copy — every new driver gets the same Pro+ trial.
 * (Former founding-cohort scarcity endpoint shape, without a slot limit.)
 */
function trialOfferStatus() {
  return {
    trialMonths: TRIAL_MONTHS,
    trialLabel: TRIAL_PRODUCT_LABEL,
    priceLabel: PRO_PRICE_LABEL,
    priceAud: PRO_PRICE_AUD,
    priceYearlyAud: PRO_PRICE_YEARLY_AUD,
    priceYearlyLabel: PRO_PRICE_YEARLY_LABEL,
    open: true,
    universal: true,
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
 * Grant the universal Pro+ signup trial. Mutates `user`.
 * Does not grant trials to admins. Does not overwrite an existing trial end.
 * @returns {boolean} true if a trial was assigned
 */
function assignSignupTrial(user) {
  if (!user) return false;
  if (user.isAdmin) {
    if (user.proTrialEndsAt == null) user.proTrialEndsAt = null;
    return false;
  }
  if (user.proTrialEndsAt) return false;
  user.proTrialEndsAt = addTrialEnd(user.createdAt || new Date().toISOString());
  return true;
}

/** @deprecated Use assignSignupTrial. */
function assignFoundingTrial(user) {
  return assignSignupTrial(user);
}

function subscriptionActive(user) {
  if (!user) return false;
  const status = String(user.subscriptionStatus || "").toLowerCase();
  if (!["active", "trialing"].includes(status)) return false;
  if (user.currentPeriodEnd) {
    const end = new Date(user.currentPeriodEnd).getTime();
    if (Number.isFinite(end) && end < Date.now()) return false;
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
    if (subscriptionActive(user)) {
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
  if (!user || user.isAdmin || subscriptionActive(user) || hasProPlusGrant(user)) return false;
  if (hasForcedFreeGrant(user)) return false;
  if (!user.proTrialEndsAt) return false;
  const end = new Date(user.proTrialEndsAt).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

/** Trial still active and ending within TRIAL_ENDING_SOON_DAYS. */
function trialEndingSoon(user, now = new Date()) {
  if (
    !trialActive(user, now) ||
    subscriptionActive(user) ||
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
  if (subscriptionActive(user)) return true;
  if (trialActive(user, now)) return true;
  return false;
}

/**
 * Ensure durable billing fields exist. Does NOT invent new trials —
 * signup trials are assigned only at register/create via assignSignupTrial.
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

function resolveEntitlements(user, records = null, now = new Date()) {
  const pro = isPro(user, now);
  const used = countUploadsThisMonth(records, now);
  const limit = pro ? null : FREE_UPLOADS_PER_MONTH;
  const remaining = pro ? null : Math.max(0, FREE_UPLOADS_PER_MONTH - used);
  const grant = normalisedPlanGrant(user);
  const trial =
    trialActive(user, now) &&
    !subscriptionActive(user) &&
    !hasProPlusGrant(user) &&
    !hasForcedFreeGrant(user);
  let status = "free";
  if (user && user.isAdmin) status = "admin";
  else if (grant === PLAN_GRANT_PRO_PLUS) status = "pro_plus";
  else if (grant === PLAN_GRANT_FREE) status = "free";
  else if (subscriptionActive(user)) status = String(user.subscriptionStatus || "active");
  else if (trial) status = "trialing";

  return {
    plan: pro ? "pro" : "free",
    status,
    isPro: pro,
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
    priceAud: PRO_PRICE_AUD,
    priceLabel: PRO_PRICE_LABEL,
    priceYearlyAud: PRO_PRICE_YEARLY_AUD,
    priceYearlyLabel: PRO_PRICE_YEARLY_LABEL,
    freeUploadsPerMonth: FREE_UPLOADS_PER_MONTH,
    softWarnAtUsed: FREE_SOFT_WARN_USED,
    trialMonths: TRIAL_MONTHS,
    softWarning: shouldSoftWarnUploads(used, remaining, pro),
  };
}

function uploadBlockedPayload(entitlements) {
  return {
    error: `Free plan includes ${FREE_UPLOADS_PER_MONTH} uploads per month and ${FREE_ONSCREEN_REPORTS} on-screen EOFY report. Upgrade to Pro (${PRO_PRICE_LABEL} or ${PRO_PRICE_YEARLY_LABEL}) for unlimited scans and PDF reports.`,
    code: "UPLOAD_LIMIT",
    entitlements,
  };
}

function proFeatureBlockedPayload(feature, entitlements) {
  const labels = {
    pdf: "PDF export",
    json: "JSON accountant export",
    forecast: "Forecast",
  };
  const label = labels[feature] || "This feature";
  return {
    error: `${label} is included with Pro (${PRO_PRICE_LABEL} or ${PRO_PRICE_YEARLY_LABEL}). You’re on the free plan — upgrade to unlock.`,
    code: "PRO_REQUIRED",
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
  ensureBillingFields,
  resolveEntitlements,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
};
