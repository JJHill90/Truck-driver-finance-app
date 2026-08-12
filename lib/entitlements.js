/**
 * Freemium entitlements for Taxation Hub (Driver Hub billing).
 *
 * Free: 15 document uploads / calendar month; on-screen EOFY summary.
 * Pro ($5/mo): unlimited uploads, PDF + accountant export, forecast.
 * Founding cohort: first 50 driver profiles get 6 months Pro trial (at signup).
 * Primary mod is always Pro and never consumes a founding slot.
 */
const FREE_UPLOADS_PER_MONTH = 15;
const PRO_PRICE_AUD = 5;
const PRO_PRICE_LABEL = "$5/month";
const TRIAL_MONTHS = 6;
const FOUNDING_TRIAL_LIMIT = 50;

function trialMs() {
  // ~183 days — stable enough for “6 months”
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

function usersList(usersOrData) {
  if (!usersOrData) return [];
  if (Array.isArray(usersOrData)) return usersOrData;
  if (usersOrData.users && typeof usersOrData.users === "object") {
    return Object.values(usersOrData.users);
  }
  return Object.values(usersOrData);
}

/** How many non-admin founding-cohort slots are already taken. */
function countFoundingCohort(usersOrData) {
  return usersList(usersOrData).filter((u) => u && u.foundingCohort && !u.isAdmin).length;
}

function foundingStatus(usersOrData) {
  const used = countFoundingCohort(usersOrData);
  const remaining = Math.max(0, FOUNDING_TRIAL_LIMIT - used);
  return {
    limit: FOUNDING_TRIAL_LIMIT,
    used,
    remaining,
    open: remaining > 0,
    trialMonths: TRIAL_MONTHS,
    priceLabel: PRO_PRICE_LABEL,
  };
}

/**
 * Assign a founding Pro trial at signup if a slot remains.
 * Mutates `user`. Does not grant trials to admins.
 * @returns {boolean} true if a founding slot was granted
 */
function assignFoundingTrial(user, usersOrData) {
  if (!user) return false;
  if (user.isAdmin) {
    user.foundingCohort = false;
    user.foundingSlot = null;
    if (user.proTrialEndsAt == null) user.proTrialEndsAt = null;
    return false;
  }
  const used = countFoundingCohort(usersOrData);
  if (used >= FOUNDING_TRIAL_LIMIT) {
    user.foundingCohort = false;
    user.foundingSlot = null;
    user.proTrialEndsAt = null;
    return false;
  }
  user.foundingCohort = true;
  user.foundingSlot = used + 1;
  user.proTrialEndsAt = addTrialEnd(user.createdAt || new Date().toISOString());
  return true;
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

function isPro(user, now = new Date()) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (subscriptionActive(user)) return true;
  if (trialActive(user, now)) return true;
  return false;
}

/**
 * Ensure durable billing fields exist. Does NOT invent new trials —
 * founding trials are assigned only at signup via assignFoundingTrial.
 * @returns {boolean} true if the record was mutated
 */
function ensureBillingFields(user) {
  if (!user) return false;
  let dirty = false;
  if (user.plan == null) {
    user.plan = "free";
    dirty = true;
  }
  if (user.foundingCohort == null) {
    user.foundingCohort = false;
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
    foundingCohort: Boolean(user && user.foundingCohort),
    foundingSlot: (user && user.foundingSlot) || null,
    trialEndsAt: (user && user.proTrialEndsAt) || null,
    currentPeriodEnd: (user && user.currentPeriodEnd) || null,
    subscriptionStatus: (user && user.subscriptionStatus) || null,
    uploadsUsed: used,
    uploadsLimit: limit,
    uploadsRemaining: remaining,
    canUpload: pro || used < FREE_UPLOADS_PER_MONTH,
    canExportPdf: pro,
    canExportJson: pro,
    canUseForecast: pro,
    priceAud: PRO_PRICE_AUD,
    priceLabel: PRO_PRICE_LABEL,
    freeUploadsPerMonth: FREE_UPLOADS_PER_MONTH,
    trialMonths: TRIAL_MONTHS,
    foundingTrialLimit: FOUNDING_TRIAL_LIMIT,
    softWarning: !pro && remaining != null && remaining > 0 && remaining <= 3,
  };
}

function uploadBlockedPayload(entitlements) {
  return {
    error: `Free plan includes ${FREE_UPLOADS_PER_MONTH} uploads per month. Upgrade to Pro (${PRO_PRICE_LABEL}) for unlimited scans and PDF reports.`,
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
  PRO_PRICE_AUD,
  PRO_PRICE_LABEL,
  TRIAL_MONTHS,
  FOUNDING_TRIAL_LIMIT,
  addTrialEnd,
  monthKey,
  countUploadsThisMonth,
  countFoundingCohort,
  foundingStatus,
  assignFoundingTrial,
  subscriptionActive,
  trialActive,
  isPro,
  ensureBillingFields,
  resolveEntitlements,
  uploadBlockedPayload,
  proFeatureBlockedPayload,
};
