/**
 * Freemium entitlements for Taxation Hub (Driver Hub billing).
 *
 * Free: 15 document uploads / calendar month + 1 on-screen EOFY report
 * (live /summary + /report in the app). PDF/JSON export and forecast are Pro.
 * Pro ($5/mo): unlimited uploads, PDF + accountant export, forecast.
 * Every new driver signup gets 3 months Pro+ trial (full Pro entitlements).
 * Users may subscribe from day 1; after the trial ends they fall back to the
 * Free limits (15 uploads + 1 on-screen report) until they choose a paid plan.
 * Primary mod is always Pro (no trial).
 */
const FREE_UPLOADS_PER_MONTH = 15;
/** On-screen EOFY report included with Free (PDF download remains Pro). */
const FREE_ONSCREEN_REPORTS = 1;
const PRO_PRICE_AUD = 5;
const PRO_PRICE_LABEL = "$5/month";
const TRIAL_MONTHS = 3;
/** Marketing label for the signup trial (same entitlements as Pro). */
const TRIAL_PRODUCT_LABEL = "Pro+";
/** Soft alert window before trial end (days). */
const TRIAL_ENDING_SOON_DAYS = 14;

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
    open: true,
    universal: true,
  };
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

/** Had a trial that has ended, and is not on a paid/admin plan. */
function trialExpired(user, now = new Date()) {
  if (!user || user.isAdmin || subscriptionActive(user)) return false;
  if (!user.proTrialEndsAt) return false;
  const end = new Date(user.proTrialEndsAt).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

/** Trial still active and ending within TRIAL_ENDING_SOON_DAYS. */
function trialEndingSoon(user, now = new Date()) {
  if (!trialActive(user, now) || subscriptionActive(user) || (user && user.isAdmin)) {
    return false;
  }
  const end = new Date(user.proTrialEndsAt).getTime();
  const msLeft = end - now.getTime();
  return msLeft > 0 && msLeft <= TRIAL_ENDING_SOON_DAYS * 24 * 60 * 60 * 1000;
}

function isPro(user, now = new Date()) {
  if (!user) return false;
  if (user.isAdmin) return true;
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
  return dirty;
}

function resolveEntitlements(user, records = null, now = new Date()) {
  const pro = isPro(user, now);
  const used = countUploadsThisMonth(records, now);
  const limit = pro ? null : FREE_UPLOADS_PER_MONTH;
  const remaining = pro ? null : Math.max(0, FREE_UPLOADS_PER_MONTH - used);
  const trial = trialActive(user, now) && !subscriptionActive(user);
  let status = "free";
  if (user && user.isAdmin) status = "admin";
  else if (subscriptionActive(user)) status = String(user.subscriptionStatus || "active");
  else if (trial) status = "trialing";

  return {
    plan: pro ? "pro" : "free",
    status,
    isPro: pro,
    isAdmin: Boolean(user && user.isAdmin),
    trialLabel: TRIAL_PRODUCT_LABEL,
    trialEndsAt: (user && user.proTrialEndsAt) || null,
    trialExpired: trialExpired(user, now),
    trialEndingSoon: trialEndingSoon(user, now),
    currentPeriodEnd: (user && user.currentPeriodEnd) || null,
    subscriptionStatus: (user && user.subscriptionStatus) || null,
    uploadsUsed: used,
    uploadsLimit: limit,
    uploadsRemaining: remaining,
    canUpload: pro || used < FREE_UPLOADS_PER_MONTH,
    /** Free always includes the live on-screen EOFY report; PDF is Pro-only. */
    canViewOnScreenReport: true,
    freeOnscreenReports: FREE_ONSCREEN_REPORTS,
    canExportPdf: pro,
    canExportJson: pro,
    canUseForecast: pro,
    priceAud: PRO_PRICE_AUD,
    priceLabel: PRO_PRICE_LABEL,
    freeUploadsPerMonth: FREE_UPLOADS_PER_MONTH,
    trialMonths: TRIAL_MONTHS,
    softWarning: !pro && remaining != null && remaining > 0 && remaining <= 3,
  };
}

function uploadBlockedPayload(entitlements) {
  return {
    error: `Free plan includes ${FREE_UPLOADS_PER_MONTH} uploads per month and ${FREE_ONSCREEN_REPORTS} on-screen EOFY report. Upgrade to Pro (${PRO_PRICE_LABEL}) for unlimited scans and PDF reports.`,
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
    error: `${label} is included with Pro (${PRO_PRICE_LABEL}). You’re on the free plan — upgrade to unlock.`,
    code: "PRO_REQUIRED",
    feature,
    entitlements,
  };
}

module.exports = {
  FREE_UPLOADS_PER_MONTH,
  FREE_ONSCREEN_REPORTS,
  PRO_PRICE_AUD,
  PRO_PRICE_LABEL,
  TRIAL_MONTHS,
  TRIAL_PRODUCT_LABEL,
  TRIAL_ENDING_SOON_DAYS,
  addTrialEnd,
  monthKey,
  countUploadsThisMonth,
  trialOfferStatus,
  foundingStatus,
  assignSignupTrial,
  assignFoundingTrial,
  subscriptionActive,
  trialActive,
  trialExpired,
  trialEndingSoon,
  isPro,
  ensureBillingFields,
  resolveEntitlements,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
};
