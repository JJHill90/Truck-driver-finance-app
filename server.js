const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const {
  getCurrentFinancialYear,
  getFinancialYearForDate,
  getCategoryMeta,
} = require("./lib/ato-standards");
const {
  ensureMealsRegistered,
  listMenuCategories,
  listMenuCategoryGroups,
  listSpecialClaimCategories,
  normalizeExpenseCategoryId,
  CAR_CLAIM_CATEGORY_IDS,
} = require("./lib/expense-menu");
const { listMenuIncomeTypes, normalizeIncomeTypeId } = require("./lib/income-menu");
const { toIsoAusDate, resolveDocumentDate } = require("./lib/aus-date");
const { refineExpenseDetectedTotals } = require("./lib/expense-total");
const {
  refineIncomeDetectedTotals,
  applyIncomePrimaryToOcr,
} = require("./lib/income-total");
const { enrichOcrFromVendors, rememberVendor } = require("./lib/vendor-enrichment");
const { applyExpensePresets, applyOcrCategoryPreset } = require("./lib/user-presets");
const { applyAbnEntityPairing } = require("./lib/abn-entity");
const { updateExpense, updateIncome } = require("./lib/ledger-edit");
const { attachReceiptToEntry } = require("./lib/attach-receipt");
const {
  withActiveLedger,
  softDeleteEntry,
  restoreEntry,
  reconcileEntries,
  unreconcileEntries,
  assertEditable,
  isDeleted,
  findEntry,
} = require("./lib/ledger-lifecycle");
const { isAwaitingConfirm, isMissingLinkedLedger } = require("./lib/unconfirmed-receipts");
const {
  listLicenceClasses,
  getLicenceClassForSalary,
  normalizeLicenceClassId,
} = require("./lib/licence-class");
const { searchTransportEmployers } = require("./lib/transport-employers");
const {
  listDriverRoleDefaults,
  getDriverRoleDefaults,
  presentDriverTypes,
} = require("./lib/driver-role-defaults");
const recordsHistory = require("./lib/records-history");
const adminAssist = require("./lib/admin-assist");
const { moveEntries } = require("./lib/ledger-move");
const storage = require("./lib/storage");
const auth = require("./lib/auth");
const { calcExpenseDeduction, summariseYear, buildAccountantReport } = require("./lib/tax-calculator");
const { decorateAccountantReport } = require("./lib/report-branding");

ensureMealsRegistered();
const { buildForecast } = require("./lib/forecast");
const {
  extractTravelAllowance,
  applyTravelAllowanceToEntry,
} = require("./lib/travel-allowance-extract");
const { summariseOvernightDays } = require("./lib/overnight-days");
const { backfillOvernightDays } = require("./lib/overnight-days-backfill");
const { backfillIncomeDescriptions } = require("./lib/income-description-backfill");
const {
  extractReceiptData,
  mergeDetectedTotals,
  normalizeOcrResult,
} = require("./lib/receipt-ocr");
const { analyzeScan } = require("./lib/document-breakdown");
const { extractPdfText } = require("./lib/pdf-text");
const { ocrPdfViaRaster, pdfResultNeedsOcr } = require("./lib/pdf-ocr");
const {
  applyHistoricalRates,
  centsPerKmForYear,
} = require("./lib/historical-rates");
const { writeJsonAtomic } = require("./lib/atomic-write");
const { createAuthSupportRateLimiters } = require("./lib/rate-limit");
const { buildReportPdf } = require("./lib/report-pdf");
const {
  buildDocumentFilename,
  labelAmountFromScan,
  labelAmountFromConfirm,
} = require("./lib/document-label");
const { findDuplicateMatches } = require("./lib/duplicate-receipt");
const { refreshInvoiceDatesFromScans } = require("./lib/receipt-date-refresh");
const { repairVendorsFromScans } = require("./lib/vendor-repair");
const { normalizeScanUpload } = require("./lib/scan-upload");
const {
  extractTaxWithheld,
  attachIncomeTaxWithheld,
  payslipTaxVisualFromRecords,
} = require("./lib/income-tax-withheld");
const {
  sanitizeIncomeFields,
  buildIncomeDescription,
  stripChequeTokens,
} = require("./lib/income-labels");
const support = require("./lib/support");
const dataDir = require("./lib/data-dir");
const backup = require("./lib/backup");
const mail = require("./lib/mail");
const entitlements = require("./lib/entitlements");
const billingStripe = require("./lib/billing-stripe");
const { HAULAGE_PR_NUMBER, formatVersionLabel } = require("./lib/version");
const { corsMiddleware, sessionCookieFlags } = require("./lib/cors");
const {
  normalizeCars,
  primaryActiveWorkUsePercent,
} = require("./lib/profile-cars");
const carTrips = require("./lib/car-trips");
const fuelNhvr = require("./lib/fuel-nhvr");
const fuelPrices = require("./lib/fuel-prices");
const fuelStations = require("./lib/fuel-stations");
const fuelEfficiency = require("./lib/fuel-efficiency");
const { planFuelStops } = require("./lib/fuel-planner");
const fuelhubStore = require("./lib/fuelhub-store");
const hubProfile = require("./lib/hub-profile");
const fuelDashboard = require("./lib/fuel-dashboard");
const fuelVehicleClass = require("./lib/fuel-vehicle-class");
const fuelForecast = require("./lib/fuel-forecast");
const fuelReceipts = require("./lib/fuel-receipts");
const suite = require("./lib/suite");
const accountantShare = require("./lib/accountant-share");
const yearCompare = require("./lib/year-compare");

const CAR_CLAIM_ID_SET = new Set(CAR_CLAIM_CATEGORY_IDS);

/** Prefill car-claim work-use % from the active vehicle when the client omits it. */
function applyActiveCarWorkUse(records, body) {
  if (!body || !CAR_CLAIM_ID_SET.has(body.category)) return body;
  if (body.workUsePercent != null && body.workUsePercent !== "") return body;
  const pct = primaryActiveWorkUsePercent((records && records.profile && records.profile.cars) || []);
  if (pct == null) return body;
  body.workUsePercent = pct;
  body.workUseFromCarProfile = true;
  return body;
}

/**
 * Persist travel / LAFHA allowance from confirm payload or OCR snapshot
 * onto an income entry (storage.addIncome is verbatim and ignores these fields).
 */
function attachTravelAllowanceToIncome(entry, payload = {}, receipt = null) {
  if (!entry) return entry;
  const payloadAmt = payload.travelAllowanceAmount;
  const payloadDays = payload.overnightDays;
  const hasPayloadAmt = payloadAmt != null && payloadAmt !== "" && Number(payloadAmt) > 0;
  const hasPayloadDays = payloadDays != null && payloadDays !== "" && Number(payloadDays) > 0;
  if (hasPayloadAmt || hasPayloadDays) {
    applyTravelAllowanceToEntry(entry, {
      travelAllowanceAmount: hasPayloadAmt ? payloadAmt : undefined,
      overnightDays: hasPayloadDays ? payloadDays : undefined,
      daysSource: payload.overnightDaysSource || "confirm",
    });
    return entry;
  }
  const ta =
    (receipt && receipt.ocrResult && receipt.ocrResult.travelAllowance) ||
    (payload && payload.travelAllowance) ||
    null;
  if (ta && (ta.detected || Number(ta.amount) > 0 || Number(ta.overnightDays) > 0)) {
    applyTravelAllowanceToEntry(entry, {
      amount: ta.amount,
      overnightDays: ta.overnightDays,
      daysSource: ta.daysSource || "ocr",
    });
  }
  return entry;
}

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_COOKIE = "haulage_sid";

// Crash-safer JSON writes without editing verbatim lib/storage.js.
storage.saveRecords = (data, filePath) => {
  writeJsonAtomic(filePath || storage.DEFAULT_FILE, data);
};

// Optional cloud OCR — only used when an API key is configured.
let openai = null;
if (process.env.OPENAI_API_KEY) {
  try {
    const OpenAI = require("openai");
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (err) {
    console.warn("OpenAI SDK unavailable, falling back to local OCR:", err.message);
  }
}

// --- Per-user record stores ---------------------------------------------
// Signed-in users get data/users/<name>.json. Guests get an empty in-memory
// shell by default (no shared disk store) unless ALLOW_GUEST_STORE=1.
const recordsCache = new Map();

function guestStoreEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.ALLOW_GUEST_STORE || "").toLowerCase()
  );
}

function emptyGuestRecords(product) {
  if (product === "suite") return suite.emptyGuestRecords();
  return {
    profile: {
      name: "",
      employer: "",
      abn: "",
      driverType: "long_haul",
      annualSalary: 85000,
      financialYear: getCurrentFinancialYear(),
      vehicleType: "truck",
      tfnSupplied: false,
    },
    vendors: [],
    expenses: [],
    income: [],
    receipts: [],
  };
}

function productOf(req) {
  return (req && req.product) || "haulage";
}

function ledgerUsername(user, product) {
  if (product === "suite" && user) {
    return suite.partnershipSeat.resolveLedgerUsername(user, (name) => auth.getUserRecord(name));
  }
  return user;
}

function fileForUser(user, product) {
  const owner = ledgerUsername(user, product);
  if (product === "suite") {
    if (!owner) return path.join(suite.SUITE_DATA_DIR, "guest.json");
    return suite.seedRecordsIfMissing(owner, auth.recordsFileFor(owner));
  }
  return owner ? auth.recordsFileFor(owner) : storage.DEFAULT_FILE;
}

function recordsForUser(user, product) {
  const prod = product || "haulage";
  const owner = ledgerUsername(user, prod);
  if (!owner) {
    if (!guestStoreEnabled()) {
      // Ephemeral empty shell — never load/persist the shared guest file.
      return emptyGuestRecords(prod);
    }
  }
  const key = suite.cacheKey(owner, prod);
  if (!recordsCache.has(key)) {
    const rec = storage.loadRecords(fileForUser(owner, prod));
    if (prod === "suite") rec.profile = suite.ensureProfile(rec.profile || {});
    recordsCache.set(key, rec);
    maybeBackfillInvoiceDates(rec, owner, prod);
    maybeBackfillVendorRepair(rec, owner, prod);
  }
  return recordsCache.get(key);
}

// One-time (per user) background repair of rows saved with the upload date
// instead of the scanned invoice date. Flagged so it runs once and never
// overrides dates the user later edits; runs in the background so it does not
// block the first request. Re-runnable on demand via the maintenance endpoint.
function maybeBackfillInvoiceDates(records, user, product) {
  if (!records || (records.meta && records.meta.invoiceDateRefreshV1)) return;
  records.meta = records.meta || {};
  records.meta.invoiceDateRefreshV1 = true; // set first to avoid re-entry
  refreshInvoiceDatesFromScans(records, { openai })
    .then((result) => {
      if (result.updated || records.meta) {
        persistUserRecords(user, records, fileForUser(user, product), {
          reason: "invoice-date-backfill",
          actor: user || "system",
        });
      }
      if (result.updated) {
        console.log(
          `Invoice-date backfill for ${user || "guest"}: updated ${result.updated} of ${result.scanned} rescanned.`
        );
      }
    })
    .catch((err) => console.warn("Invoice-date backfill failed:", err.message));
}

// One-time (per user) repair of junk/empty vendors from stored receipt OCR text
// (no image re-OCR — that stays opt-in via the maintenance/admin endpoints).
function maybeBackfillVendorRepair(records, user, product) {
  if (!records || (records.meta && records.meta.vendorRepairV1)) return;
  records.meta = records.meta || {};
  records.meta.vendorRepairV1 = true;
  repairVendorsFromScans(records, { openai: null, dryRun: false, reOcr: false })
    .then((result) => {
      if (result.updated || records.meta) {
        persistUserRecords(user, records, fileForUser(user, product), {
          reason: "vendor-repair-backfill",
          actor: user || "system",
        });
      }
      if (result.updated) {
        console.log(
          `Vendor repair backfill for ${user || "guest"}: updated ${result.updated} of ${result.eligible} eligible.`
        );
      }
    })
    .catch((err) => console.warn("Vendor repair backfill failed:", err.message));
}
function getRecords(req) {
  return recordsForUser(req.user, productOf(req));
}
function sessionUsername(req) {
  return req.user ? String(req.user) : null;
}

/** Snapshot (when username known) then persist records to disk. */
function persistUserRecords(username, records, file, meta = {}) {
  if (username) {
    try {
      recordsHistory.snapshotRecords(username, records, {
        reason: meta.reason || "auto",
        actor: meta.actor || username,
      });
    } catch (err) {
      console.warn("records history snapshot failed:", err.message);
    }
  }
  storage.saveRecords(records, file);
}

function persist(req, meta = {}) {
  const prod = productOf(req);
  persistUserRecords(ledgerUsername(req.user, prod), getRecords(req), fileForUser(req.user, prod), {
    reason: meta.reason || "auto",
    actor: sessionUsername(req) || req.user || null,
  });
}

/** Write every in-memory records cache entry to disk before a full-store backup. */
function flushAllCachedRecordsToDisk() {
  for (const [key, records] of recordsCache.entries()) {
    try {
      const parsed = suite.parseCacheKey(key);
      if (!parsed.user && !guestStoreEnabled()) continue;
      storage.saveRecords(records, fileForUser(parsed.user, parsed.product));
    } catch (err) {
      console.warn(`Backup flush failed for ${key}:`, err.message);
    }
  }
}

function expenseAnalysis(req, entry) {
  if (productOf(req) === "suite") {
    const profile = (getRecords(req) && getRecords(req).profile) || {};
    return suite.calcExpenseDeduction(entry, profile);
  }
  return calcExpenseDeduction(entry);
}

function scopedSuiteRecords(records) {
  return suite.extraEntity.scopeRecords(records);
}

function summariseFor(req, records, profile) {
  if (productOf(req) === "suite") {
    const scoped = scopedSuiteRecords(records);
    return suite.summariseYear(scoped, profile || scoped.profile);
  }
  const summary = summariseYear(records, profile);
  applyHistoricalRates(summary, records, profile && profile.financialYear);
  return summary;
}

function clearRecordsCache() {
  recordsCache.clear();
}

async function notifyBackupComplete(result) {
  const to = String(
    process.env.BACKUP_NOTIFY_EMAIL || process.env.SUPPORT_EMAIL || ""
  ).trim();
  if (!to || !mail.mailConfigured()) return;
  const s3Line =
    result.s3 && result.s3.uploaded
      ? `S3: s3://${result.s3.bucket}/${result.s3.key}`
      : result.s3 && result.s3.error
        ? `S3 upload failed: ${result.s3.error}`
        : "S3: not configured";
  const offsiteLine =
    result.offsite && result.offsite.copied
      ? `Off-site copy: ${result.offsite.path}`
      : result.offsite && result.offsite.error
        ? `Off-site copy failed: ${result.offsite.error}`
        : "Off-site dir: not configured";
  const text = [
    "Driver Hub — data backup completed",
    "",
    `Backup id: ${result.id}`,
    `Reason: ${result.reason || "—"}`,
    `Size: ${result.bytes} bytes`,
    `SHA-256: ${result.sha256}`,
    s3Line,
    offsiteLine,
    "",
    "Download from Profile → Primary mod → Data backups, or restore from there if needed.",
  ].join("\n");
  try {
    await mail.sendMail({
      to,
      subject: `Driver Hub backup ${result.id}`,
      text,
    });
  } catch (err) {
    console.warn("Backup notify email failed:", err.message);
  }
}

/** Records view for tax/UI — soft-deleted ledger rows excluded. */
function getActiveRecords(req) {
  return withActiveLedger(getRecords(req));
}

/** Resolve freemium entitlements for the signed-in user (guests = free, no uploads). */
function resolveReqEntitlements(req) {
  const product = productOf(req);
  if (!req.user) return entitlements.resolveEntitlements(null, null, new Date(), { product });
  const user = auth.getUserRecord(req.user);
  return entitlements.resolveEntitlements(user, getRecords(req), new Date(), { product });
}

/** Soft gate: free plan monthly upload quota (402 + UPLOAD_LIMIT). */
function assertCanUpload(req, res) {
  const ent = resolveReqEntitlements(req);
  if (ent.canUpload) return ent;
  res.status(402).json(entitlements.uploadBlockedPayload(ent));
  return null;
}

/** Soft gate: Pro-only features (402 + PRO_REQUIRED). */
function assertProFeature(req, res, feature) {
  const ent = resolveReqEntitlements(req);
  if (ent.isPro) return ent;
  res.status(402).json(entitlements.proFeatureBlockedPayload(feature, ent));
  return null;
}

/** Soft gate: Pro+ extras (402 + PRO_PLUS_REQUIRED). */
function assertProPlusFeature(req, res, feature) {
  const ent = resolveReqEntitlements(req);
  // Driver Hub Taxation: share / BAS / multi-year unlock with Pro (same price).
  // Suite keeps a separate Pro+ tier for those packs.
  const haulageEofyPacks = new Set(["share", "bas", "year_compare"]);
  if (productOf(req) !== "suite" && haulageEofyPacks.has(feature) && ent.isPro) {
    return ent;
  }
  if (ent.isProPlus) return ent;
  res.status(402).json(entitlements.proPlusFeatureBlockedPayload(feature, ent));
  return null;
}

function openaiForReq(req) {
  const ent = resolveReqEntitlements(req);
  return ent && ent.canCloudOcr ? openai : null;
}

function profileFor(records, financialYear) {
  return { ...records.profile, financialYear: financialYear || records.profile.financialYear };
}
function loadTargetUserRecords(username, req) {
  const user = auth.getUser(username);
  if (!user) return null;
  const prod = req ? productOf(req) : "haulage";
  const key = suite.cacheKey(user.username, prod);
  const file = fileForUser(user.username, prod);
  let records;
  if (recordsCache.has(key)) {
    records = recordsCache.get(key);
  } else {
    records = storage.loadRecords(file);
    if (prod === "suite") records.profile = suite.ensureProfile(records.profile || {});
    recordsCache.set(key, records);
  }
  return { user, records, file };
}

function persistTarget(loaded, meta = {}) {
  persistUserRecords(loaded.user.username, loaded.records, loaded.file, {
    reason: meta.reason || "admin-override",
    actor: meta.actor || null,
  });
}

function adminTargetFuelhub(req, res) {
  if (!requireAdmin(req, res)) return null;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return null;
  }
  const account = auth.getUser(loaded.user.username);
  const hub = hubProfile.presentHubProfile(account, loaded.records);
  const store = fuelhubStore.ensureFuelhub(loaded.records, { hubProfile: hub });
  return { loaded, store, hub };
}

function adminFuelhubPayload(store) {
  return fuelhubStore.snapshot(store);
}

/** Prefer labeled invoice/payment dates so FY placement follows the document day. */
function applyResolvedDocumentDate(ocrResult, purpose, payPeriod) {
  if (!ocrResult || typeof ocrResult !== "object") return null;
  const rawText = ocrResult.rawText || ocrResult.rawTextPreview || "";
  const resolved = resolveDocumentDate({
    ocrDate: ocrResult.date,
    rawText,
    purpose: purpose === "income" ? "income" : "expense",
    payPeriod,
  });
  if (resolved) {
    ocrResult.date = resolved;
  } else {
    // Drop far-future / unparsable OCR dates (e.g. 20/07/70 → 2070) so the
    // confirm form falls back to today instead of inventing FY 2070-71.
    const iso = ocrResult.date ? toIsoAusDate(ocrResult.date) : null;
    ocrResult.date = iso || null;
  }
  return ocrResult.date || null;
}

function normalizePayloadDate(payload) {
  if (!payload || payload.date == null || payload.date === "") return payload;
  const iso = toIsoAusDate(payload.date);
  if (iso) payload.date = iso;
  else payload.date = "";
  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token, req) {
  const flags = sessionCookieFlags(req);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; ${flags}; Max-Age=${60 * 60 * 24 * 30}`
  );
}
function clearSessionCookie(res, req) {
  const flags = sessionCookieFlags(req);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${flags}; Max-Age=0`);
}

// Merge the typed component breakdown with the provided detected totals,
// preferring typed labels, de-duplicating by amount, keeping one primary.
// For expenses, the primary is the overall/grand total (else the largest amount).
// Missing-data / compliance alerts for the current user's records.
function buildAlerts(records, product) {
  const alerts = [];
  const profile = records.profile || {};
  const summary =
    product === "suite" ? suite.summariseYear(records, profile) : summariseYear(records, profile);

  const missing = [];
  if (!profile.name) missing.push("name");
  if (product === "suite") {
    const entity = suite.normalizeEntityType(profile.entityType || profile.driverType);
    if (entity === "employee" && !profile.employer) missing.push("employer");
    if (entity === "sole_trader" && !profile.abn && !profile.tradingName && !profile.employer) {
      missing.push("ABN or trading name");
    }
    if (entity === "partnership" && !profile.partnershipName) missing.push("partnership name");
  } else if (!profile.employer) {
    missing.push("employer");
  }
  if (!Number(profile.annualSalary)) missing.push("annual salary");
  if (missing.length) {
    alerts.push({ level: "info", message: `Complete your profile: ${missing.join(", ")}.` });
  }

  const needReceipt = (records.expenses || []).filter((e) => {
    const meta =
      product === "suite" ? suite.getCategoryMeta(e.category) : getCategoryMeta(e.category);
    const needs =
      meta &&
      ["receipt", "written_evidence", "receipt_and_work_use"].includes(meta.substantiation);
    return needs && !e.receiptId && Number(e.amount) > 0;
  });
  if (needReceipt.length) {
    alerts.push({
      level: "warning",
      message: `${needReceipt.length} expense(s) need a receipt attached for ATO substantiation.`,
    });
  }

  if (summary.substantiation && summary.substantiation.required) {
    alerts.push({ level: "warning", message: summary.substantiation.message });
  }
  if (!(records.income || []).length) {
    alerts.push({
      level: "info",
      message:
        product === "suite"
          ? `No income recorded${profile.financialYear ? ` for FY ${profile.financialYear}` : ""} yet — scan a PAYG income statement, invoice or partnership distribution.`
          : `No income recorded${profile.financialYear ? ` for FY ${profile.financialYear}` : ""} yet — scan a payslip or remittance.`,
    });
  }
  if (!(records.expenses || []).length) {
    alerts.push({
      level: "info",
      message: "No expenses recorded yet — scan a receipt to start tracking deductions.",
    });
  }
  return alerts;
}

const app = express();
// Allowlisted CORS for Play / iOS WebViews and any cross-origin frontends.
// Same-origin Render deploys need no CORS_ORIGINS. See lib/cors.js.
app.use(corsMiddleware);

// Stripe webhooks need the raw body for signature verification — mount before
// express.json() so the payload is not pre-parsed.
app.post(
  "/api/haulage/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["stripe-signature"];
      const result = await billingStripe.handleWebhook({
        rawBody: req.body,
        signature,
        findUserByUsername: (username) => auth.getUserRecord(username),
        findUserByCustomerId: (customerId) => {
          const name = auth.findUsernameByStripeCustomerId(customerId);
          return name ? auth.getUserRecord(name) : null;
        },
        saveUser: (user) => {
          if (!user || !user.username) return;
          auth.updateBilling(user.username, {
            plan: user.plan,
            stripeCustomerId: user.stripeCustomerId,
            stripeSubscriptionId: user.stripeSubscriptionId,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionInterval: user.subscriptionInterval,
            subscriptionTier: user.subscriptionTier || null,
            cancelAtPeriodEnd: user.cancelAtPeriodEnd,
            currentPeriodEnd: user.currentPeriodEnd,
            planUpdatedAt: new Date().toISOString(),
          });
        },
      });
      res.json(result);
    } catch (err) {
      const status = err && err.type === "StripeSignatureVerificationError" ? 400 : 400;
      console.warn("[billing] webhook error:", err && err.message);
      res.status(status).json({ error: (err && err.message) || "Webhook failed" });
    }
  }
);

app.use(express.json({ limit: "30mb" }));

const api = express.Router();

/** Multipart scan uploads (Firefox-friendly alternative to giant JSON base64). */
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

function optionalScanMultipart(req, res, next) {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("multipart/form-data")) {
    next();
    return;
  }
  scanUpload.single("file")(req, res, (err) => {
    if (err) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "Upload too large (max 25 MB)."
          : err.message || "Upload failed.";
      res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
      return;
    }
    next();
  });
}

// Resolve product (Taxation Hub vs Go Taxation Suite) then the signed-in user.
api.use((req, _res, next) => {
  req.product = suite.productOf(req);
  const token = parseCookies(req)[SESSION_COOKIE];
  req.sessionToken = token || null;
  req.user = auth.getSessionUser(token);
  next();
});

// Guests (not signed in) are read-only. Any signed-in profile may add/alter
// their own data. Reads (GET/HEAD) plus login/logout, self-register, and the
// read-only expense preview stay open without a session.
const OPEN_WRITE_PATHS = new Set([
  "/auth/login",
  "/auth/logout",
  "/auth/register",
  "/auth/recover/request",
  "/auth/recover/reset",
  "/auth/password-strength",
  "/expenses/preview",
  "/support/contact",
]);
api.use((req, res, next) => {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  if (OPEN_WRITE_PATHS.has(req.path)) {
    next();
    return;
  }
  if (req.user) {
    next();
    return;
  }
  res.status(403).json({
    error: "Sign in on the Profile tab before adding or changing data. Guests have read-only access.",
  });
});

// Rate-limit auth + support contact POSTs (in-memory; per process).
api.use(createAuthSupportRateLimiters());

// --- Auth ----------------------------------------------------------------
api.post("/auth/password-strength", (req, res) => {
  const { password, username } = req.body || {};
  res.json(auth.scorePassword(password, username));
});

api.post("/auth/register", (req, res) => {
  const { username, password, email, presets } = req.body || {};
  try {
    const user = auth.registerUser(username, password, presets, email);
    const token = auth.createSession(user.username);
    recordsForUser(user.username, productOf(req)); // initialise their store
    setSessionCookie(res, token, req);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  const result = auth.attemptLogin(username, password);
  if (!result.user) {
    let err = "Invalid username or password.";
    const payload = {
      error: err,
      needsRecovery: result.needsRecovery,
      failedLoginCount: result.failedLoginCount,
      locked: Boolean(result.locked),
      lockedUntil: result.lockedUntil || null,
    };
    if (result.locked) {
      err =
        "This account is temporarily locked after too many failed sign-ins. Use “Forgot username / password?”, wait for the lockout to expire, or ask the primary mod to unlock it.";
      payload.error = err;
      payload.needsRecovery = true;
    }
    // On the 10th failed attempt, email a recovery link (once) when the
    // account has an email on file.
    if (result.needsRecovery && result.failedLoginCount === auth.MAX_FAILED_LOGINS) {
      if (!result.locked) {
        err = `Too many failed sign-ins (${auth.MAX_FAILED_LOGINS}). Check your email for a recovery link, or use “Forgot username / password?”.`;
        payload.error = err;
      }
      try {
        const existing = auth.getUser(username);
        if (existing && existing.email) {
          const recovery = auth.createRecoveryTokenForEmail(existing.email);
          if (recovery.found) {
            const base = mail.appBaseUrl(req);
            const recoveryPath = `${suite.recoveryPagePath(req)}?token=${encodeURIComponent(recovery.token)}`;
            const resetUrl = `${base}${recoveryPath}`;
            const sent = await mail.sendRecoveryEmail({
              to: recovery.email,
              username: recovery.username,
              resetUrl,
            });
            // Same-origin path so the UI can continue without SMTP / email delivery.
            payload.emailSent = Boolean(sent.sent);
            if (!sent.sent) {
              payload.recoveryUrl = recoveryPath;
              payload.devRecoveryUrl = resetUrl; // legacy alias
              payload.devUsername = recovery.username;
            }
          }
        } else if (!result.locked) {
          err =
            `Too many failed sign-ins (${auth.MAX_FAILED_LOGINS}). This profile has no email — ask the primary mod for a password reset, or recover once an email is on file.`;
          payload.error = err;
        }
      } catch (mailErr) {
        console.warn("[auth] auto-recovery email failed:", mailErr.message);
      }
    } else if (result.needsRecovery && !result.locked) {
      err = `Too many failed sign-ins (${auth.MAX_FAILED_LOGINS}). Use “Forgot username / password?” to recover via email.`;
      payload.error = err;
    }
    res.status(401).json(payload);
    return;
  }
  const user = result.user;
  const token = auth.createSession(user.username);
  recordsForUser(user.username, productOf(req));
  setSessionCookie(res, token, req);

  // Periodic email reminder when password is older than 90 days.
  try {
    const due = auth.consumePasswordReminder(user.username);
    if (due && due.email) {
      const base = mail.appBaseUrl(req);
      await mail.sendPasswordAgeEmail({
        to: due.email,
        username: due.username,
        changeUrl: `${base}/haulage/#profile`,
      });
    }
  } catch (err) {
    console.warn("[auth] password-age email failed:", err.message);
  }

  res.json({ user });
});

api.post("/auth/logout", (req, res) => {
  auth.destroySession(req.sessionToken);
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

api.get("/auth/me", (req, res) => {
  const user = req.user ? auth.getUser(req.user) : null;
  const ent = user ? resolveReqEntitlements(req) : null;
  res.json({ user, entitlements: ent });
});

api.post("/auth/presets", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in to save presets." });
    return;
  }
  res.json({ user: auth.updatePresets(req.user, req.body || {}) });
});

api.post("/auth/email", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in to update your email." });
    return;
  }
  try {
    const user = auth.updateEmail(req.user, (req.body || {}).email);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/auth/change-password", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in to change your password." });
    return;
  }
  const { currentPassword, newPassword } = req.body || {};
  try {
    const user = auth.changePassword(req.user, currentPassword, newPassword);
    // Password change clears sessions — issue a fresh cookie.
    const token = auth.createSession(user.username);
    setSessionCookie(res, token, req);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/auth/recover/request", async (req, res) => {
  const email = (req.body || {}).email;
  const generic = {
    ok: true,
    emailSent: false,
    message:
      "If that email is registered, we sent a recovery link. Check your inbox (and spam).",
  };
  try {
    const recovery = auth.createRecoveryTokenForEmail(email);
    if (recovery.found) {
      const base = mail.appBaseUrl(req);
      const recoveryPath = `${suite.recoveryPagePath(req)}?token=${encodeURIComponent(recovery.token)}`;
      const resetUrl = `${base}${recoveryPath}`;
      const sent = await mail.sendRecoveryEmail({
        to: recovery.email,
        username: recovery.username,
        resetUrl,
      });
      generic.emailSent = Boolean(sent.sent);
      if (sent.sent) {
        generic.message =
          "If that email is registered, we sent a recovery link. Check your inbox (and spam).";
      } else {
        // No SMTP (or send failed): continue in-browser with a same-origin link.
        // Do not treat this as an error — hosted installs often have no mail yet.
        generic.message =
          "Email delivery is not configured on this server. Use the recovery link below to reset your password (expires in 1 hour).";
        generic.recoveryUrl = recoveryPath;
        generic.devRecoveryUrl = resetUrl; // legacy alias
        generic.devUsername = recovery.username;
      }
    }
    res.json(generic);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get("/auth/recover/peek", (req, res) => {
  try {
    const info = auth.peekRecovery(req.query.token);
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/auth/recover/reset", (req, res) => {
  const { token, password } = req.body || {};
  try {
    const user = auth.resetPasswordWithToken(token, password);
    const session = auth.createSession(user.username);
    recordsForUser(user.username, productOf(req));
    setSessionCookie(res, session, req);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get("/alerts", (req, res) => {
  const alerts = buildAlerts(getActiveRecords(req), productOf(req));
  const user = req.user ? auth.getUser(req.user) : null;
  if (user) alerts.push(...auth.accountAlerts(user, productOf(req)));
  res.json({ alerts, user: user || req.user || null });
});

const { summariseLafha } = require("./lib/lafha");

api.get("/lafha", (req, res) => {
  const records = getRecords(req);
  const fy =
    req.query.financialYear ||
    (records.profile && records.profile.financialYear) ||
    getCurrentFinancialYear();
  const summary =
    productOf(req) === "suite"
      ? suite.summariseLafha(records.profile || {}, records.income || [], fy)
      : summariseLafha(records.profile || {}, records.income || [], fy);
  res.json(summary);
});

api.get("/version", (req, res) => {
  const product = suite.productMeta(req);
  res.json({
    prNumber: HAULAGE_PR_NUMBER,
    label: formatVersionLabel(HAULAGE_PR_NUMBER),
    ...product,
    storage: dataDir.describeStorage(),
  });
});

function fuelhubState(req) {
  const records = getRecords(req);
  const account = req.user ? auth.getUser(req.user) : null;
  const hub = hubProfile.presentHubProfile(account, records);
  return { store: fuelhubStore.ensureFuelhub(records, { hubProfile: hub }), hub, records };
}

function fuelhubBootstrap(req) {
  const { store, hub } = fuelhubState(req);
  const snap = fuelhubStore.snapshot(store);
  const seeded = !store.truckSavedAt;
  return {
    ...snap,
    hubProfile: { ...hub, truckSeeded: seeded },
    retailers: fuelPrices.listRetailers(),
    combinations: fuelNhvr.listCombinations(),
    massSchemes: fuelNhvr.listMassSchemes(),
    networks: fuelNhvr.listNetworks(),
    corridors: fuelNhvr.listCorridors().map((c) => ({
      id: c.id,
      name: c.name,
      distanceKm: c.distanceKm,
      nhvrNetworks: c.nhvrNetworks,
      westPremium: c.westPremium,
    })),
    tables: fuelPrices.governmentTables(),
    stations: fuelStations.listStations({ observedPrices: store.observedPrices }),
    efficiency: fuelEfficiency.describeEfficiency(store.truck, {
      driverType: hub.driverType,
    }),
    driverTypes: presentDriverTypes(),
    licenceClasses: listLicenceClasses(),
    workCombinations: hubProfile.listWorkCombinations(),
    fuelClasses: fuelVehicleClass.listFuelClasses(),
    dashboard: fuelDashboard.buildDashboard({
      store,
      hub,
      efficiency: fuelEfficiency.describeEfficiency(store.truck, {
        driverType: hub.driverType,
      }),
    }),
    forecast: fuelForecast.buildFuelForecast({ store, truck: store.truck }),
    confirmMs: fuelReceipts.CONFIRM_MS,
  };
}

api.get("/hub/profile", (req, res) => {
  const records = getRecords(req);
  const account = req.user ? auth.getUser(req.user) : null;
  res.json({
    hubProfile: hubProfile.presentHubProfile(account, records),
    apps: ["taxationhub", "fuelhub"],
    note: "One Driver Hub login and profile file is shared by every hub app. App-specific data (tax ledger, fuel truck spec) stays in the same records document under its own key.",
  });
});

api.get("/fuelhub", (req, res) => {
  res.json(fuelhubBootstrap(req));
});

api.get("/fuelhub/dashboard", (req, res) => {
  const { store, hub } = fuelhubState(req);
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng != null ? req.query.lng : req.query.lon);
  const point = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const efficiency = fuelEfficiency.describeEfficiency(store.truck, {
    driverType: hub.driverType,
  });
  res.json(
    fuelDashboard.buildDashboard({
      store,
      hub,
      point,
      efficiency,
    })
  );
});

api.get("/fuelhub/stations", (req, res) => {
  const { store } = fuelhubState(req);
  res.json({
    stations: fuelStations.listStations({
      corridorId: req.query.corridor || undefined,
      q: req.query.q || undefined,
      observedPrices: store.observedPrices,
    }),
  });
});

api.put("/fuelhub/truck", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to save a Fuel Hub truck spec." });
    return;
  }
  const { store, hub } = fuelhubState(req);
  const truck = fuelhubStore.saveTruck(
    store,
    {
      ...(req.body || {}),
      driverType: hub.driverType,
    },
    { hubProfile: hub }
  );
  persist(req, { reason: "fuelhub-truck" });
  res.json({
    truck,
    truckSource: store.truckSource,
    efficiency: fuelEfficiency.describeEfficiency(truck, { driverType: hub.driverType }),
  });
});

function persistFuelVehicles(req, vehicles) {
  const records = getRecords(req);
  records.profile = records.profile || {};
  records.profile.fuelVehicles = fuelVehicleClass.normalizeFuelVehicles(vehicles);
  const hub = hubProfile.presentHubProfile(req.user ? auth.getUser(req.user) : null, records);
  const store = fuelhubStore.ensureFuelhub(records, { hubProfile: hub });
  persist(req, { reason: "fuelhub-vehicles" });
  return {
    fuelVehicles: hub.fuelVehicles,
    activeFuelVehicle: hub.activeFuelVehicle,
    hubProfile: hub,
    truck: store.truck,
    efficiency: fuelEfficiency.describeEfficiency(store.truck, { driverType: hub.driverType }),
  };
}

api.post("/fuelhub/vehicles", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to save a registered fuel vehicle." });
    return;
  }
  try {
    const records = getRecords(req);
    const next = fuelVehicleClass.upsertFuelVehicle((records.profile && records.profile.fuelVehicles) || [], req.body || {});
    res.json(persistFuelVehicles(req, next));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.put("/fuelhub/vehicles/:id", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to update a registered fuel vehicle." });
    return;
  }
  try {
    const records = getRecords(req);
    const next = fuelVehicleClass.upsertFuelVehicle((records.profile && records.profile.fuelVehicles) || [], {
      ...(req.body || {}),
      id: req.params.id,
    });
    res.json(persistFuelVehicles(req, next));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post("/fuelhub/vehicles/:id/activate", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to activate a registered fuel vehicle." });
    return;
  }
  try {
    const records = getRecords(req);
    const next = fuelVehicleClass.activateFuelVehicle(
      (records.profile && records.profile.fuelVehicles) || [],
      req.params.id
    );
    res.json(persistFuelVehicles(req, next));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/fuelhub/vehicles/:id", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to remove a registered fuel vehicle." });
    return;
  }
  const records = getRecords(req);
  const before = (records.profile && records.profile.fuelVehicles) || [];
  const next = fuelVehicleClass.removeFuelVehicle(before, req.params.id);
  if (next.length === before.length) {
    res.status(404).json({ error: "Registered fuel vehicle not found." });
    return;
  }
  res.json(persistFuelVehicles(req, next));
});

api.post("/fuelhub/cards", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to save a fuel card." });
    return;
  }
  try {
    const { store, hub } = fuelhubState(req);
    const payload = { ...(req.body || {}) };
    if (!payload.company && hub && hub.employer) payload.company = hub.employer;
    const card = fuelhubStore.upsertCard(store, payload);
    persist(req, { reason: "fuelhub-card" });
    res.json({ card, cards: store.cards });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/fuelhub/cards/:id", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to remove a fuel card." });
    return;
  }
  const { store } = fuelhubState(req);
  const removed = fuelhubStore.removeCard(store, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Fuel card not found." });
    return;
  }
  persist(req, { reason: "fuelhub-card-delete" });
  res.json({ ok: true, cards: store.cards });
});

api.post("/fuelhub/prices/observed", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to log a bowser price." });
    return;
  }
  try {
    const { store } = fuelhubState(req);
    const row = fuelhubStore.recordObservedPrice(store, req.body || {});
    persist(req, { reason: "fuelhub-price" });
    res.json({
      observed: row,
      stations: fuelStations.listStations({ observedPrices: store.observedPrices }),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get("/fuelhub/forecast", (req, res) => {
  const { store } = fuelhubState(req);
  const q = req.query || {};
  const hasRoute = Boolean(q.origin || q.destination);
  const input = hasRoute
    ? {
        origin: q.origin,
        destination: q.destination,
        via: fuelForecast.splitVia(q.via),
        refillAt: q.refillAt || q.refuelAt,
        payloadT: q.payloadT,
        addedPayloadT: q.addedPayloadT,
        hours: q.hours,
        currentFuelL: q.currentFuelL,
      }
    : undefined;
  res.json(fuelForecast.buildFuelForecast({ store, truck: store.truck, input }));
});

api.post("/fuelhub/plan", (req, res) => {
  const { store, hub } = fuelhubState(req);
  const body = req.body || {};
  const via = fuelForecast.splitVia(body.via);
  const truck = {
    ...(body.truck || store.truck || {}),
    driverType: hub.driverType,
  };
  if (body.payloadT != null && body.payloadT !== "") truck.payloadT = body.payloadT;
  if (body.currentFuelL != null && body.currentFuelL !== "") truck.currentFuelL = body.currentFuelL;
  const plan = planFuelStops({
    origin: body.origin,
    destination: body.destination,
    via,
    distanceKm: body.distanceKm,
    truck,
    cards: body.cards || store.cards,
    observedPrices: store.observedPrices,
  });
  const forecast = fuelForecast.buildFuelForecast({
    store,
    truck,
    input: {
      origin: body.origin,
      destination: body.destination,
      via,
      refillAt: body.refillAt || body.refuelAt,
      payloadT: body.payloadT,
      addedPayloadT: body.addedPayloadT,
      hours: body.hours,
      currentFuelL: body.currentFuelL != null ? body.currentFuelL : truck.currentFuelL,
    },
  });
  plan.forecast = forecast.prediction;
  fuelhubStore.saveLastPlan(store, {
    ...fuelDashboard.summarisePlan(plan),
    forecast: forecast.prediction
      ? {
          origin: forecast.prediction.origin,
          destination: forecast.prediction.destination,
          via: forecast.prediction.via,
          refillAt: forecast.prediction.refillAt,
          payloadT: forecast.prediction.payloadT,
          addedPayloadT: forecast.prediction.addedPayloadT,
          distanceKm: forecast.prediction.distanceKm,
          hours: forecast.prediction.hours,
          timeFactor: forecast.prediction.timeFactor,
          litresPerKm: forecast.prediction.averageLitresPerKm,
          litresPer100km: forecast.prediction.averageLitresPer100km,
          note: forecast.prediction.note,
          refillAdvice: forecast.prediction.refillAdvice,
          hops: (forecast.prediction.hops || []).map((h) => ({
            from: h.from,
            to: h.to,
            distanceKm: h.distanceKm,
            hours: h.hours,
            payloadT: h.payloadT,
            litresPerKm: h.litresPerKm,
            burnL: h.burnL,
            fillL: h.fillL,
            minFillL: h.minFillL,
            idealFillL: h.idealFillL,
            refillHere: h.refillHere,
          })),
          scenarios: (forecast.prediction.scenarios || []).map((s) => ({
            id: s.id,
            name: s.name,
            note: s.note,
            litresPerKm: s.litresPerKm,
            litresPer100km: s.litresPer100km,
            fillL: s.fillL,
            costAud: s.costAud,
          })),
        }
      : null,
  });
  if (req.user) persist(req, { reason: "fuelhub-plan" });
  res.json({ plan, lastPlan: store.lastPlan, forecast });
});

api.post("/fuelhub/trips", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to save a Fuel Hub trip." });
    return;
  }
  try {
    const { store } = fuelhubState(req);
    const trip = fuelhubStore.saveTrip(store, req.body || {});
    persist(req, { reason: "fuelhub-trip" });
    res.json({ trip, trips: fuelhubStore.snapshot(store).trips });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post("/fuelhub/track", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to record GPS points." });
    return;
  }
  try {
    const { store } = fuelhubState(req);
    const track = fuelhubStore.appendTrack(store, req.body || {});
    persist(req, { reason: "fuelhub-track" });
    const efficiency = fuelEfficiency.describeEfficiency(store.truck);
    const remainingKm = Math.max(0, efficiency.rangeKm - (track.km || 0));
    res.json({
      track: {
        id: track.id,
        km: track.km,
        startedAt: track.startedAt,
        updatedAt: track.updatedAt,
        pointCount: (track.points || []).length,
      },
      remainingKm: Math.round(remainingKm * 10) / 10,
      efficiency,
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/fuelhub/track", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to reset GPS tracking." });
    return;
  }
  const { store } = fuelhubState(req);
  store.activeTrack = null;
  persist(req, { reason: "fuelhub-track-reset" });
  res.json({ ok: true });
});

function fuelReceiptPayload(store) {
  return {
    employerContacts: (store.employerContacts || []).map(fuelReceipts.presentContact),
    fuelReceipts: (store.fuelReceipts || []).map(fuelReceipts.presentReceipt),
    confirmMs: fuelReceipts.CONFIRM_MS,
  };
}

api.post("/fuelhub/contacts", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to save an employer contact." });
    return;
  }
  try {
    const { store } = fuelhubState(req);
    const contact = fuelReceipts.upsertContact(store, req.body || {});
    persist(req, { reason: "fuelhub-contact" });
    res.json({ contact: fuelReceipts.presentContact(contact), ...fuelReceiptPayload(store) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/fuelhub/contacts/:id", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to remove an employer contact." });
    return;
  }
  const { store } = fuelhubState(req);
  const removed = fuelReceipts.removeContact(store, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  persist(req, { reason: "fuelhub-contact-delete" });
  res.json({ ok: true, ...fuelReceiptPayload(store) });
});

api.post("/fuelhub/receipts/scan", optionalScanMultipart, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Sign in to scan a fuel receipt." });
      return;
    }
    if (!assertCanUpload(req, res)) return;
    const { imageBase64, mimeType, filename } = normalizeScanUpload(req);
    if (!imageBase64) {
      res.status(400).json({ error: "Missing image data." });
      return;
    }
    const ocrResult = await extractReceiptData(openaiForReq(req), imageBase64, mimeType, filename, {
      purpose: "expense",
    });
    applyAbnEntityPairing(ocrResult, "expense");
    applyResolvedDocumentDate(ocrResult, "expense", null);
    const { store } = fuelhubState(req);
    const receipt = fuelReceipts.createFromScan(store, {
      ocr: ocrResult,
      filename: filename || "fuel-receipt.jpg",
      mimeType: mimeType || "image/jpeg",
      dataUrl: imageBase64,
    });
    persist(req, { reason: "fuelhub-receipt-scan" });
    res.json({
      receipt: fuelReceipts.presentReceipt(receipt),
      ocr: {
        vendor: ocrResult.vendor || "",
        entity: ocrResult.entity || "",
        date: ocrResult.date || "",
        amount: ocrResult.amount || null,
        preview: String(ocrResult.rawTextPreview || ocrResult.rawText || "").slice(0, 400),
      },
      ...fuelReceiptPayload(store),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not scan fuel receipt." });
  }
});

api.post("/fuelhub/receipts/:id/confirm", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to confirm a fuel receipt." });
    return;
  }
  try {
    const { store } = fuelhubState(req);
    const receipt = fuelReceipts.confirmDetails(store, req.params.id, req.body || {});
    persist(req, { reason: "fuelhub-receipt-confirm" });
    res.json({ receipt: fuelReceipts.presentReceipt(receipt), ...fuelReceiptPayload(store) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post("/fuelhub/receipts/:id/nominate", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to nominate an employer." });
    return;
  }
  try {
    const { store } = fuelhubState(req);
    const body = req.body || {};
    let contactRaw = body;
    if (body.contactId) {
      const existing = (store.employerContacts || []).find((c) => c.id === body.contactId);
      if (!existing) {
        res.status(404).json({ error: "Saved contact not found." });
        return;
      }
      contactRaw = existing;
    }
    const result = fuelReceipts.nominate(store, req.params.id, contactRaw);
    persist(req, { reason: "fuelhub-receipt-nominate" });
    res.json({
      receipt: fuelReceipts.presentReceipt(result.receipt),
      contact: fuelReceipts.presentContact(result.contact),
      ...fuelReceiptPayload(store),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post("/fuelhub/receipts/:id/send", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to send a fuel receipt." });
    return;
  }
  try {
    const { store, hub } = fuelhubState(req);
    const row = fuelReceipts.findReceipt(store, req.params.id);
    fuelReceipts.assertSendable(row, { force: Boolean((req.body || {}).force) });
    const contact =
      (store.employerContacts || []).find((c) => c.id === row.contactId) || {
        name: row.contactName,
        email: row.contactEmail,
        company: row.contactCompany,
      };
    const account = auth.getUser(req.user) || {};
    const report = fuelReceipts.buildReport({
      receipt: row,
      contact,
      hub,
      username: req.user,
    });
    const attachments = [];
    const abs = fuelReceipts.receiptImageAbsPath(row.imagePath);
    if (abs && fs.existsSync(abs)) {
      attachments.push({
        filename: row.filename || path.basename(abs),
        content: fs.readFileSync(abs),
        contentType: row.mimeType || "image/jpeg",
      });
    }
    let mailResult = await mail.sendMail({
      to: row.contactEmail,
      subject: report.subject,
      text: report.text,
      html: report.html,
      replyTo: account.email || undefined,
      attachments,
    });
    if (mailResult && mailResult.preview && !mailResult.sent) {
      mailResult = { sent: true, channel: "dev", preview: true };
    }
    const receipt = fuelReceipts.markSent(store, row.id, mailResult);
    persist(req, { reason: "fuelhub-receipt-send" });
    res.json({
      receipt: fuelReceipts.presentReceipt(receipt),
      mail: receipt.mail,
      ...fuelReceiptPayload(store),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message, remainingMs: err.remainingMs });
  }
});

api.post("/fuelhub/receipts/:id/cancel", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to cancel a fuel receipt." });
    return;
  }
  try {
    const { store } = fuelhubState(req);
    const receipt = fuelReceipts.cancelReceipt(store, req.params.id);
    persist(req, { reason: "fuelhub-receipt-cancel" });
    res.json({ receipt: fuelReceipts.presentReceipt(receipt), ...fuelReceiptPayload(store) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.get("/fuelhub/receipts/:id/file", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to view a fuel receipt." });
    return;
  }
  const { store } = fuelhubState(req);
  const row = fuelReceipts.findReceipt(store, req.params.id);
  const abs = row && fuelReceipts.receiptImageAbsPath(row.imagePath);
  if (!abs || !fs.existsSync(abs)) {
    res.status(404).json({ error: "Receipt image not found." });
    return;
  }
  res.setHeader("Content-Type", row.mimeType || "image/jpeg");
  res.sendFile(abs);
});

// --- Primary-mod admin ---------------------------------------------------
function requireAdmin(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Log in as the primary mod to continue." });
    return false;
  }
  if (!auth.isAdminUser(req.user)) {
    res.status(403).json({ error: "Primary mod access required." });
    return false;
  }
  return true;
}

function userRecordsSummary(username, req) {
  const prod = req ? productOf(req) : "haulage";
  const file = fileForUser(username, prod);
  const key = suite.cacheKey(username, prod);
  // Prefer the live in-memory store when this user is already cached (e.g. they
  // are signed in elsewhere on this process); otherwise read from disk.
  const records = recordsCache.has(key) ? recordsCache.get(key) : storage.loadRecords(file);
  const fy = records.profile?.financialYear || getCurrentFinancialYear();
  const summary =
    prod === "suite"
      ? suite.summariseYear(records, profileFor(records, fy))
      : summariseYear(records, profileFor(records, fy));
  if (prod !== "suite") applyHistoricalRates(summary, records, fy);
  return {
    user: auth.getUser(username),
    profile: records.profile || {},
    counts: {
      expenses: (records.expenses || []).length,
      income: (records.income || []).length,
      receipts: (records.receipts || []).length,
      fuelCards: Array.isArray(records.fuelhub?.cards) ? records.fuelhub.cards.length : 0,
      fuelTrips: Array.isArray(records.fuelhub?.trips) ? records.fuelhub.trips.length : 0,
      fuelReceipts: Array.isArray(records.fuelhub?.fuelReceipts)
        ? records.fuelhub.fuelReceipts.length
        : 0,
    },
    totals: {
      financialYear: fy,
      grossIncome: summary.income?.assessableTotal ?? 0,
      deductibleExpenses: summary.expenses?.deductibleTotal ?? 0,
      netTaxableIncome: summary.taxEstimate?.taxableIncome ?? 0,
      estimatedTax: summary.taxEstimate?.totalTax ?? 0,
    },
  };
}

api.get("/admin/users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  auth.ensurePrimaryAdmin();
  const users = auth.listUsers().map((u) => {
    try {
      const snap = userRecordsSummary(u.username, req);
      return { ...u, counts: snap.counts, totals: snap.totals, profileName: snap.profile.name || "" };
    } catch (err) {
      return { ...u, counts: { expenses: 0, income: 0, receipts: 0 }, totals: null, error: err.message };
    }
  });
  res.json({ users, admin: auth.getUser(req.user) });
});

api.get("/admin/users/:username", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const { user: target, records } = loaded;
  const fy = req.query.financialYear || records.profile?.financialYear || getCurrentFinancialYear();

  const receipts = (records.receipts || []).map((r) => ({
    id: r.id,
    filename: r.filename,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    linkedExpenseId: r.linkedExpenseId || null,
    linkedIncomeId: r.linkedIncomeId || null,
    hasImage: Boolean(r.imagePath),
  }));

  const includeDeleted = String(req.query.includeDeleted || "") === "1";
  const expenses = includeDeleted
    ? records.expenses || []
    : withActiveLedger(records).expenses || [];
  const income = includeDeleted ? records.income || [] : withActiveLedger(records).income || [];
  const deletedExpenses = (records.expenses || []).filter((e) => isDeleted(e));
  const deletedIncome = (records.income || []).filter((i) => isDeleted(i));

  const targetRecord = auth.getUserRecord(target.username);
  const hub = productOf(req) === "suite" ? null : hubProfile.presentHubProfile(target, records);
  const fuelStore =
    productOf(req) === "suite" ? null : fuelhubStore.ensureFuelhub(records, { hubProfile: hub });
  res.json({
    user: target,
    account: adminAssist.adminAccountStatus(target.username),
    entitlements: entitlements.resolveEntitlements(targetRecord, records),
    profile: records.profile || {},
    expenses,
    income,
    deletedExpenses,
    deletedIncome,
    receipts,
    fuelhub: fuelStore ? fuelhubStore.snapshot(fuelStore) : null,
    carTrips: (() => {
      carTrips.ensureCarTrips(records);
      return includeDeleted
        ? records.carTrips || []
        : (records.carTrips || []).filter((t) => t && !t.deletedAt);
    })(),
    vendors: storage.listVendors(records),
    history: recordsHistory.listSnapshots(target.username, { limit: 20 }),
    summary: summariseFor(req, withActiveLedger(records), profileFor(records, fy)),
  });
});

/** Admin: dry-run or apply junk-vendor repairs from attached receipt scans. */
api.post("/admin/users/:username/repair-vendors", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const loaded = loadTargetUserRecords(req.params.username, req);
    if (!loaded) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const body = req.body || {};
    const dryRun = body.dryRun !== false; // default preview for admin safety
    const reOcr = Boolean(body.reOcr);
    const limit = Math.max(0, Math.min(500, Number(body.limit) || 0));
    const result = await repairVendorsFromScans(loaded.records, {
      openai,
      dryRun,
      reOcr,
      limit,
    });
    loaded.records.meta = loaded.records.meta || {};
    loaded.records.meta.vendorRepairV1 = true;
    if (!dryRun) {
      persistTarget(loaded, {
        reason: "admin-vendor-repair",
        actor: req.user,
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Admin: unlock reconciled ledger rows for a driver. */
api.post("/admin/users/:username/:type(expenses|income)/unreconcile", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const type = req.params.type === "income" ? "income" : "expense";
  const result = unreconcileEntries(loaded.records, type, (req.body && req.body.ids) || [], {
    username: sessionUsername(req),
  });
  if (result.updated.length) {
    persistTarget(loaded, { reason: "admin-unreconcile", actor: sessionUsername(req) });
  }
  res.json({ ok: true, updated: result.updated.length, notFound: result.notFound });
});

/** Admin: restore soft-deleted ledger rows for a driver. */
api.post("/admin/users/:username/:type(expenses|income)/restore", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const type = req.params.type === "income" ? "income" : "expense";
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const restored = [];
  const errors = [];
  for (const id of ids) {
    const result = restoreEntry(loaded.records, type, id, { username: sessionUsername(req) });
    if (result.ok) restored.push(result.entry);
    else errors.push({ id, error: result.error, code: result.code });
  }
  if (restored.length) {
    persistTarget(loaded, { reason: "admin-restore-entry", actor: sessionUsername(req) });
  }
  res.json({ ok: true, restored: restored.length, entries: restored, errors });
});

/** Admin: force soft-delete (including reconciled) for cleanup. */
api.post("/admin/users/:username/:type(expenses|income)/soft-delete", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const type = req.params.type === "income" ? "income" : "expense";
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const deleted = [];
  const errors = [];
  for (const id of ids) {
    const result = softDeleteEntry(loaded.records, type, id, {
      username: sessionUsername(req),
      force: true,
    });
    if (result.ok) deleted.push(result.entry);
    else errors.push({ id, error: result.error, code: result.code });
  }
  if (deleted.length) {
    persistTarget(loaded, { reason: "admin-soft-delete", actor: sessionUsername(req) });
  }
  res.json({ ok: true, deleted: deleted.length, entries: deleted, errors });
});

/** Admin: move selected expenses ↔ income (soft-delete source, create opposite row). */
api.post("/admin/users/:username/:type(expenses|income)/move", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const fromType = req.params.type === "income" ? "income" : "expense";
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  if (!ids.length) {
    res.status(400).json({ error: "Select one or more entries to move." });
    return;
  }
  const result = moveEntries(loaded.records, fromType, ids, {
    username: sessionUsername(req),
  });
  if (result.movedCount) {
    persistTarget(loaded, { reason: "admin-move-entry", actor: sessionUsername(req) });
  }
  const toType = fromType === "expense" ? "income" : "expense";
  res.json({
    ok: true,
    moved: result.movedCount,
    toType,
    entries: result.moved.map((m) => m.to),
    errors: result.errors,
  });
});

/** Admin: reconcile ledger rows on a driver's behalf. */
api.post("/admin/users/:username/:type(expenses|income)/reconcile", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const type = req.params.type === "income" ? "income" : "expense";
  const result = reconcileEntries(loaded.records, type, (req.body && req.body.ids) || [], {
    username: sessionUsername(req),
  });
  if (result.updated.length) {
    persistTarget(loaded, { reason: "admin-reconcile", actor: sessionUsername(req) });
  }
  res.json({ ok: true, updated: result.updated.length, notFound: result.notFound });
});

/** Admin: edit a driver's expense/income row (overrides locks). */
api.put("/admin/users/:username/:type(expenses|income)/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const isIncome = req.params.type === "income";
  const type = isIncome ? "income" : "expense";
  const entry = findEntry(loaded.records, type, req.params.id);
  if (!entry) {
    res.status(404).json({ error: "Entry not found." });
    return;
  }
  // Unlock first so a mistaken reconcile does not block the correction.
  if (entry.reconciled) {
    unreconcileEntries(loaded.records, type, [req.params.id], {
      username: sessionUsername(req),
    });
  }
  if (isDeleted(entry)) {
    restoreEntry(loaded.records, type, req.params.id, { username: sessionUsername(req) });
  }
  const updated = isIncome
    ? updateIncome(loaded.records, req.params.id, req.body || {})
    : updateExpense(loaded.records, req.params.id, req.body || {});
  if (!updated) {
    res.status(404).json({ error: "Entry not found." });
    return;
  }
  updated.adminEditedAt = new Date().toISOString();
  updated.adminEditedBy = sessionUsername(req);
  persistTarget(loaded, { reason: "admin-edit-entry", actor: sessionUsername(req) });
  res.json({ ok: true, entry: updated });
});

/** Admin: add a new expense or income row on a driver's ledger. */
api.post("/admin/users/:username/:type(expenses|income)", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const isIncome = req.params.type === "income";
  const body = normalizePayloadDate({ ...(req.body || {}) });
  if (!isIncome && body.category) body.category = normalizeExpenseCategoryId(body.category);
  if (isIncome && body.type) body.type = normalizeIncomeTypeId(body.type) || body.type;
  const entry = isIncome
    ? storage.addIncome(loaded.records, body)
    : storage.addExpense(loaded.records, body);
  entry.adminCreatedAt = new Date().toISOString();
  entry.adminCreatedBy = sessionUsername(req);
  if (isIncome) {
    attachIncomeTaxWithheld(entry, body, null);
  }
  if (!isIncome) {
    rememberVendor(loaded.records, {
      name: body.vendor || entry.vendor,
      abn: body.vendorAbn || entry.vendorAbn,
      category: body.category || entry.category,
    });
  }
  persistTarget(loaded, { reason: "admin-add-entry", actor: sessionUsername(req) });
  res.status(201).json({ ok: true, entry });
});

/** Admin: override driver profile fields. */
api.put("/admin/users/:username/profile", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const body = { ...(req.body || {}) };
  if (body.annualSalary != null && body.annualSalary !== "") {
    body.annualSalary = Number(body.annualSalary);
  }
  const fromSalary = getLicenceClassForSalary(
    body.annualSalary ?? loaded.records.profile?.annualSalary
  );
  const normalised = normalizeLicenceClassId(body.licenceClass);
  if (body.licenceClass !== undefined) {
    body.licenceClass = normalised || fromSalary;
  } else if (body.annualSalary != null) {
    body.licenceClass = fromSalary;
  }
  delete body.salaryBand;
  if (Object.prototype.hasOwnProperty.call(body, "cars")) {
    body.cars = normalizeCars(body.cars);
  }
  const profile = storage.updateProfile(
    loaded.records,
    hubProfile.applyProfileVehicleFields(body, loaded.records.profile || {})
  );
  const hub = hubProfile.presentHubProfile(auth.getUser(req.params.username), loaded.records);
  fuelhubStore.ensureFuelhub(loaded.records, { hubProfile: hub });
  persistTarget(loaded, { reason: "admin-edit-profile", actor: sessionUsername(req) });
  res.json({ ok: true, profile });
});

/** Admin: set a temporary password (clears failed logins / sessions). */
api.post("/admin/users/:username/password", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const password = String((req.body && req.body.password) || "");
    const user = adminAssist.adminSetPassword(req.params.username, password);
    res.json({
      ok: true,
      user,
      message: "Password updated. The driver should sign in with the new password.",
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Admin: set / update account email. */
/** Admin: upgrade driver to Pro+ or downgrade to Free at any time. */
api.post("/admin/users/:username/plan", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const grant = String((req.body && req.body.plan) || "").toLowerCase();
  try {
    const result = auth.setPlanGrant(req.params.username, grant, {
      by: sessionUsername(req),
    });
    res.json({
      ok: true,
      user: result.user,
      entitlements: result.entitlements,
      message:
        grant === "pro_plus"
          ? `${result.user.username} upgraded to Pro+ (admin grant).`
          : `${result.user.username} downgraded to Free.`,
    });
  } catch (err) {
    const code = /not found/i.test(err.message)
      ? 404
      : /primary mod|must be/i.test(err.message)
        ? 400
        : 400;
    res.status(code).json({ error: err.message });
  }
});

api.post("/admin/users/:username/email", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const user = adminAssist.adminSetEmail(req.params.username, (req.body && req.body.email) || "");
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Admin: clear failed-login lockout. */
api.post("/admin/users/:username/clear-failed-logins", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const user = adminAssist.adminClearFailedLogins(req.params.username);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Admin: create a password-recovery link (and email it when SMTP is set). */
api.post("/admin/users/:username/recover-link", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const recovery = adminAssist.adminCreateRecovery(req.params.username);
    const base = mail.appBaseUrl(req);
    const recoveryPath = `${base}${suite.recoveryPagePath(req)}?token=${encodeURIComponent(recovery.token)}`;
    let emailed = false;
    if (mail.mailConfigured()) {
      const sent = await mail.sendRecoveryEmail({
        to: recovery.email,
        username: recovery.username,
        resetUrl: recoveryPath,
      });
      emailed = Boolean(sent && sent.sent);
    }
    res.json({
      ok: true,
      username: recovery.username,
      email: recovery.email,
      expiresAt: recovery.expiresAt,
      emailed,
      recoveryUrl: recoveryPath,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Admin: list automatic / assist snapshots for a driver. */
api.get("/admin/users/:username/history", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const target = auth.getUser(req.params.username);
  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const snapshots = recordsHistory.listSnapshots(target.username, {
    limit: Number(req.query.limit) || 30,
  });
  res.json({ username: target.username, snapshots });
});

/** Admin: restore a driver's full records file from a snapshot. */
api.post("/admin/users/:username/history/:snapshotId/restore", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const snap = recordsHistory.loadSnapshotRecords(loaded.user.username, req.params.snapshotId);
  if (!snap) {
    res.status(404).json({ error: "Snapshot not found." });
    return;
  }
  // Keep a safety snapshot of the live file before overwriting.
  try {
    recordsHistory.snapshotRecords(loaded.user.username, loaded.records, {
      reason: "pre-history-restore",
      actor: sessionUsername(req),
    });
  } catch (err) {
    console.warn("pre-restore snapshot failed:", err.message);
  }

  const restored = snap.records;
  // Replace in-place so the cache reference stays valid for this process.
  for (const key of Object.keys(loaded.records)) {
    delete loaded.records[key];
  }
  Object.assign(loaded.records, restored);
  storage.saveRecords(loaded.records, loaded.file);
  try {
    recordsHistory.snapshotRecords(loaded.user.username, loaded.records, {
      reason: "admin-history-restore",
      actor: sessionUsername(req),
    });
  } catch (err) {
    console.warn("post-restore snapshot failed:", err.message);
  }
  res.json({
    ok: true,
    username: loaded.user.username,
    restoredFrom: snap.meta,
    counts: recordsHistory.summariseCounts(loaded.records),
  });
});

api.get("/admin/users/:username/receipts/:id/file", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const target = auth.getUser(req.params.username);
  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const records = recordsCache.has(target.username)
    ? recordsCache.get(target.username)
    : storage.loadRecords(auth.recordsFileFor(target.username));
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const info = receipt?.imagePath ? storage.getReceiptFileInfo(receipt.imagePath) : null;
  if (!info) {
    res.status(404).json({ error: "Receipt file not found." });
    return;
  }
  res.setHeader("Content-Type", info.mime);
  if (req.query.download) {
    const downloadName = String(receipt.filename || info.filename || "document").replace(/"/g, "");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  }
  res.sendFile(info.filePath);
});

api.delete("/admin/users/:username/receipts/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const receipts = loaded.records.receipts || [];
  const idx = receipts.findIndex((r) => r.id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ error: "Receipt not found." });
    return;
  }
  const receipt = receipts[idx];
  if (receipt.imagePath) storage.deleteReceiptFile(receipt.imagePath);
  receipts.splice(idx, 1);
  persistTarget(loaded, { reason: "admin-delete-receipt", actor: sessionUsername(req) });
  res.json({ ok: true, id: req.params.id });
});

api.put("/admin/users/:username/fuelhub/truck", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  try {
    const truck = fuelhubStore.saveTruck(
      ctx.store,
      { ...(req.body || {}), driverType: ctx.hub.driverType },
      { hubProfile: ctx.hub }
    );
    persistTarget(ctx.loaded, { reason: "admin-fuelhub-truck", actor: sessionUsername(req) });
    res.json({ ok: true, truck, fuelhub: adminFuelhubPayload(ctx.store) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.post("/admin/users/:username/fuelhub/cards", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  try {
    const card = fuelhubStore.upsertCard(ctx.store, req.body || {});
    persistTarget(ctx.loaded, { reason: "admin-fuelhub-card", actor: sessionUsername(req) });
    res.json({ ok: true, card, fuelhub: adminFuelhubPayload(ctx.store) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/admin/users/:username/fuelhub/cards/:id", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  const removed = fuelhubStore.removeCard(ctx.store, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Fuel card not found." });
    return;
  }
  persistTarget(ctx.loaded, { reason: "admin-fuelhub-card-delete", actor: sessionUsername(req) });
  res.json({ ok: true, fuelhub: adminFuelhubPayload(ctx.store) });
});

api.post("/admin/users/:username/fuelhub/trips", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  try {
    const trip = fuelhubStore.saveTrip(ctx.store, req.body || {});
    persistTarget(ctx.loaded, { reason: "admin-fuelhub-trip", actor: sessionUsername(req) });
    res.json({ ok: true, trip, fuelhub: adminFuelhubPayload(ctx.store) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/admin/users/:username/fuelhub/trips/:id", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  const removed = fuelhubStore.removeTrip(ctx.store, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Trip not found." });
    return;
  }
  persistTarget(ctx.loaded, { reason: "admin-fuelhub-trip-delete", actor: sessionUsername(req) });
  res.json({ ok: true, fuelhub: adminFuelhubPayload(ctx.store) });
});

api.post("/admin/users/:username/fuelhub/contacts", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  try {
    const contact = fuelReceipts.upsertContact(ctx.store, req.body || {});
    persistTarget(ctx.loaded, { reason: "admin-fuelhub-contact", actor: sessionUsername(req) });
    res.json({
      ok: true,
      contact: fuelReceipts.presentContact(contact),
      fuelhub: adminFuelhubPayload(ctx.store),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/admin/users/:username/fuelhub/contacts/:id", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  const removed = fuelReceipts.removeContact(ctx.store, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  persistTarget(ctx.loaded, { reason: "admin-fuelhub-contact-delete", actor: sessionUsername(req) });
  res.json({ ok: true, fuelhub: adminFuelhubPayload(ctx.store) });
});

api.post("/admin/users/:username/fuelhub/receipts", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  try {
    const body = req.body || {};
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "Fuel receipt needs a dollar amount." });
      return;
    }
    const row = fuelReceipts.createFromScan(ctx.store, {
      ocr: {
        vendor: body.vendor,
        date: body.date,
        amount,
        notes: body.notes,
        rawText: body.litres ? `${body.litres} L` : "",
      },
      filename: body.filename || "admin-fuel-receipt",
    });
    const confirmed = fuelReceipts.confirmDetails(ctx.store, row.id, {
      vendor: body.vendor,
      date: body.date,
      amount,
      litres: body.litres,
      site: body.site || body.vendor,
      notes: body.notes,
    });
    persistTarget(ctx.loaded, { reason: "admin-fuelhub-receipt", actor: sessionUsername(req) });
    res.status(201).json({
      ok: true,
      receipt: fuelReceipts.presentReceipt(confirmed),
      fuelhub: adminFuelhubPayload(ctx.store),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/admin/users/:username/fuelhub/receipts/:id", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  const removed = fuelReceipts.removeReceipt(ctx.store, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Fuel receipt not found." });
    return;
  }
  persistTarget(ctx.loaded, { reason: "admin-fuelhub-receipt-delete", actor: sessionUsername(req) });
  res.json({ ok: true, fuelhub: adminFuelhubPayload(ctx.store) });
});

api.get("/admin/users/:username/fuelhub/receipts/:id/file", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  const row = fuelReceipts.findReceipt(ctx.store, req.params.id);
  const abs = row && fuelReceipts.receiptImageAbsPath(row.imagePath);
  if (!abs || !fs.existsSync(abs)) {
    res.status(404).json({ error: "Fuel receipt file not found." });
    return;
  }
  res.setHeader("Content-Type", row.mimeType || "application/octet-stream");
  if (req.query.download) {
    const downloadName = String(row.filename || "fuel-receipt").replace(/"/g, "");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  }
  res.sendFile(path.resolve(abs));
});

api.post("/admin/users/:username/fuelhub/prices", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  try {
    const row = fuelhubStore.recordObservedPrice(ctx.store, req.body || {});
    persistTarget(ctx.loaded, { reason: "admin-fuelhub-price", actor: sessionUsername(req) });
    res.json({ ok: true, price: row, fuelhub: adminFuelhubPayload(ctx.store) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

api.delete("/admin/users/:username/fuelhub/prices/:stationId", (req, res) => {
  const ctx = adminTargetFuelhub(req, res);
  if (!ctx) return;
  const removed = fuelhubStore.removeObservedPrice(ctx.store, req.params.stationId);
  if (!removed) {
    res.status(404).json({ error: "Observed price not found." });
    return;
  }
  persistTarget(ctx.loaded, { reason: "admin-fuelhub-price-delete", actor: sessionUsername(req) });
  res.json({ ok: true, fuelhub: adminFuelhubPayload(ctx.store) });
});


// --- Admin: car trips (ATO D1) -------------------------------------------
api.post("/admin/users/:username/car-trips", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const result = carTrips.createTrip(loaded.records, req.body || {}, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  if (result.trip.method === carTrips.METHODS.CENTS) {
    carTrips.syncCentsTripExpense(loaded.records, result.trip, {
      storageAddExpense: (recs, payload) => storage.addExpense(recs, payload),
    });
  }
  persistTarget(loaded, { reason: "admin-car-trip-create", actor: sessionUsername(req) });
  res.json({ ok: true, trip: result.trip });
});

api.put("/admin/users/:username/car-trips/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const result = carTrips.updateTrip(loaded.records, req.params.id, req.body || {});
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  persistTarget(loaded, { reason: "admin-car-trip-update", actor: sessionUsername(req) });
  res.json({ ok: true, trip: result.trip });
});

api.post("/admin/users/:username/car-trips/:id/close", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const result = carTrips.closeTrip(loaded.records, req.params.id, req.body || {}, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  persistTarget(loaded, { reason: "admin-car-trip-close", actor: sessionUsername(req) });
  res.json({ ok: true, trip: result.trip });
});

api.post("/admin/users/:username/car-trips/reconcile", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const ids = (req.body && req.body.ids) || [];
  const result = carTrips.reconcileTrips(loaded.records, ids, { username: sessionUsername(req) });
  persistTarget(loaded, { reason: "admin-car-trip-reconcile", actor: sessionUsername(req) });
  res.json({ ok: true, updated: result.updated.length, trips: result.updated });
});

api.post("/admin/users/:username/car-trips/unreconcile", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const ids = (req.body && req.body.ids) || [];
  const result = carTrips.unreconcileTrips(loaded.records, ids, { username: sessionUsername(req) });
  persistTarget(loaded, { reason: "admin-car-trip-unreconcile", actor: sessionUsername(req) });
  res.json({ ok: true, updated: result.updated.length, trips: result.updated });
});

api.post("/admin/users/:username/car-trips/:id/soft-delete", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const result = carTrips.softDeleteTrip(loaded.records, req.params.id, {
    username: sessionUsername(req),
    force: true,
  });
  if (!result.ok) {
    res.status(result.code === "not_found" ? 404 : 400).json({ error: result.error, code: result.code });
    return;
  }
  carTrips.softDeleteLinkedExpense(loaded.records, result.trip, {
    softDeleteEntry,
    username: sessionUsername(req),
  });
  persistTarget(loaded, { reason: "admin-car-trip-delete", actor: sessionUsername(req) });
  res.json({ ok: true, trip: result.trip });
});

api.post("/admin/users/:username/car-trips/:id/restore", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username, req);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const result = carTrips.restoreTrip(loaded.records, req.params.id, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    res.status(result.code === "not_found" ? 404 : 400).json({ error: result.error, code: result.code });
    return;
  }
  persistTarget(loaded, { reason: "admin-car-trip-restore", actor: sessionUsername(req) });
  res.json({ ok: true, trip: result.trip });
});


api.post("/admin/users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { username, password, email } = req.body || {};
  try {
    const user = auth.createUser(username, password, {}, email);
    // Seed an empty per-user records file so the profile is ready immediately.
    storage.loadRecords(auth.recordsFileFor(user.username));
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.delete("/admin/users/:username", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const targetName = req.params.username;
  if (auth.usernameKey(targetName) === auth.usernameKey(req.user)) {
    res.status(400).json({ error: "You cannot delete your own primary mod account." });
    return;
  }
  try {
    const target = auth.getUser(targetName);
    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const recordsFile = auth.recordsFileFor(target.username);
    let records = null;
    if (recordsCache.has(target.username)) {
      records = recordsCache.get(target.username);
    } else if (fs.existsSync(recordsFile)) {
      records = storage.loadRecords(recordsFile);
    }
    if (records) {
      for (const r of records.receipts || []) {
        if (r.imagePath) storage.deleteReceiptFile(r.imagePath);
      }
    }
    auth.deleteUser(target.username);
    recordsCache.delete(target.username);
    recordsCache.delete(`suite:${target.username}`);
    if (fs.existsSync(recordsFile)) fs.unlinkSync(recordsFile);
    const suiteFile = suite.recordsFileFor(target.username);
    if (fs.existsSync(suiteFile)) fs.unlinkSync(suiteFile);
    res.json({ ok: true, username: target.username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Full-store backups (primary mod) ------------------------------------
api.get("/admin/backups", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    status: backup.getStatus(),
    backups: backup.listBackups(),
  });
});

api.post("/admin/backups", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await backup.createBackup({
      reason: "manual",
      actor: req.user,
      flushFn: flushAllCachedRecordsToDisk,
    });
    notifyBackupComplete(result).catch(() => {});
    res.status(201).json({ backup: result });
  } catch (err) {
    const status = err.code === "BACKUP_BUSY" ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

api.get("/admin/backups/:id/download", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const file = backup.getBackupFile(req.params.id);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`
    );
    res.sendFile(file.path);
  } catch (err) {
    const status = err.code === "NOT_FOUND" || /Invalid backup id/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

api.post("/admin/backups/:id/restore", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await backup.restoreBackup(req.params.id, {
      confirm: req.body && req.body.confirm,
      flushFn: flushAllCachedRecordsToDisk,
    });
    clearRecordsCache();
    res.json({ ok: true, ...result });
  } catch (err) {
    let status = 500;
    if (err.code === "CONFIRM_REQUIRED") status = 400;
    else if (err.code === "BACKUP_BUSY") status = 409;
    else if (err.code === "NOT_FOUND" || /Invalid backup id/i.test(err.message)) status = 404;
    res.status(status).json({ error: err.message });
  }
});

// --- Reference data ------------------------------------------------------
api.get("/standards", (req, res) => {
  if (productOf(req) === "suite") {
    const records = getRecords(req);
    const entity = suite.normalizeEntityType(
      (req.query.entityType || req.query.driverType || records.profile?.entityType || records.profile?.driverType)
    );
    res.json(suite.standards(entity));
    return;
  }
  res.json({
    categories: listMenuCategories(),
    specialClaimCategories: listSpecialClaimCategories(),
    categoryGroups: listMenuCategoryGroups(),
    incomeTypes: listMenuIncomeTypes(),
    driverTypes: presentDriverTypes(),
    licenceClasses: listLicenceClasses(),
    workCombinations: hubProfile.listWorkCombinations(),
    driverRoleDefaults: listDriverRoleDefaults(),
    financialYear: getCurrentFinancialYear(),
  });
});

// Predictive employer names for the Profile "Employer" field (open to guests).
api.get("/employers", (req, res) => {
  const q = String(req.query.q || req.query.query || "");
  const limit = Number(req.query.limit) || 12;
  if (productOf(req) === "suite") {
    res.json({
      query: q,
      employers: suite.searchEmployers(q, { limit }),
    });
    return;
  }
  res.json({
    query: q,
    employers: searchTransportEmployers(q, { limit }),
  });
});

api.get("/occupations", (req, res) => {
  const q = String(req.query.q || req.query.query || "");
  const limit = Number(req.query.limit) || 20;
  if (productOf(req) !== "suite") {
    res.json({ query: q, occupations: [] });
    return;
  }
  res.json({
    query: q,
    occupations: suite.searchOccupations(q, { limit }),
  });
});

api.get("/driver-role-defaults", (req, res) => {
  if (productOf(req) === "suite") {
    const type = String(req.query.driverType || req.query.type || req.query.entityType || "");
    if (type) {
      return res.json({ default: suite.getEntityDefaults(type) });
    }
    return res.json({ defaults: suite.listEntityDefaults() });
  }
  const type = String(req.query.driverType || req.query.type || "");
  if (type) {
    const one = getDriverRoleDefaults(type);
    if (!one) return res.status(404).json({ error: "Unknown driver type" });
    return res.json({ default: one });
  }
  res.json({ defaults: listDriverRoleDefaults() });
});

api.get("/records", (req, res) => {
  const full = getRecords(req);
  const descBackfill = backfillIncomeDescriptions(full);
  const overnightBackfill = backfillOvernightDays(full);
  if (descBackfill.updated > 0 || overnightBackfill.updated > 0) persist(req);
  const records = withActiveLedger(full);
  const activeIncome = records.income || [];
  const activeExpenses = records.expenses || [];
  const receipts = (records.receipts || []).map((r) => {
    const base = {
      ...r,
      hasImage: Boolean(r.imagePath),
      dataUrl: undefined,
    };
    // Gallery can show scans before Approve — flag orphans for the UI.
    base.awaitingConfirm = isAwaitingConfirm(base);
    base.missingLinkedLedger = isMissingLinkedLedger(base, activeIncome, activeExpenses);
    return base;
  });
  carTrips.ensureCarTrips(full);
  const trips = (full.carTrips || []).filter((t) => t && !t.deletedAt);
  res.json({
    ...records,
    carTrips: trips,
    carClaimMethod: carTrips.normalizeMethod(
      (full.profile && full.profile.carClaimMethod) || carTrips.METHODS.CENTS
    ),
    carCentsPreview: carTrips.centsClaimPreview(
      full,
      (records.profile && records.profile.financialYear) || getCurrentFinancialYear()
    ),
    receipts,
    vendors: storage.listVendors(full),
  });
});

// --- Profile -------------------------------------------------------------
api.put("/profile", (req, res) => {
  const records = getRecords(req);
  const body = { ...(req.body || {}) };
  if (body.annualSalary != null && body.annualSalary !== "") {
    body.annualSalary = Number(body.annualSalary);
  }
  if (productOf(req) === "suite") {
    if (Object.prototype.hasOwnProperty.call(body, "cars")) {
      body.cars = normalizeCars(body.cars);
    }
    if (Object.prototype.hasOwnProperty.call(body, "carClaimMethod")) {
      body.carClaimMethod = carTrips.normalizeMethod(body.carClaimMethod);
    }
    const merged = suite.applySuiteProfile(body, records.profile || {});
    const plus = resolveReqEntitlements(req);
    if (Object.prototype.hasOwnProperty.call(body, "extraEntities")) {
      if (plus.isProPlus) {
        suite.extraEntity.applyExtraEntities(merged, body.extraEntities, { replace: true });
      } else {
        suite.extraEntity.ensureExtraEntities(merged);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "activeEntityId")) {
      merged.activeEntityId = body.activeEntityId;
      suite.extraEntity.ensureExtraEntities(merged);
    }
    const profile = storage.updateProfile(records, merged);
    persist(req);
    res.json({ profile, hubProfile: null, product: "gotax" });
    return;
  }
  // Licence class (LR/MR → MC) follows annual salary when omitted or invalid.
  const fromSalary = getLicenceClassForSalary(body.annualSalary ?? records.profile?.annualSalary);
  const normalised = normalizeLicenceClassId(body.licenceClass);
  body.licenceClass = normalised || fromSalary;
  // Drop legacy Band 1/2/3 UI field if a client still posts it — ATO travel
  // bands are derived from salary in the tax calculator, not stored here.
  delete body.salaryBand;
  // Work-car presets (Car Expenses) — validate shape before merge.
  if (Object.prototype.hasOwnProperty.call(body, "cars")) {
    body.cars = normalizeCars(body.cars);
  }
  if (Object.prototype.hasOwnProperty.call(body, "carClaimMethod")) {
    body.carClaimMethod = carTrips.normalizeMethod(body.carClaimMethod);
  }
  // Registered fuel-class vehicles (Fuel Hub) — not ATO work cars.
  if (Object.prototype.hasOwnProperty.call(body, "fuelVehicles")) {
    body.fuelVehicles = fuelVehicleClass.normalizeFuelVehicles(body.fuelVehicles);
  }
  const merged = hubProfile.applyProfileVehicleFields(body, records.profile || {});
  const profile = storage.updateProfile(records, merged);
  const hub = hubProfile.presentHubProfile(req.user ? auth.getUser(req.user) : null, records);
  fuelhubStore.ensureFuelhub(records, { hubProfile: hub });
  persist(req);
  res.json({ profile, hubProfile: hub });
});


// --- Car trips (ATO D1 cents/km + logbook) --------------------------------
api.get("/car-trips", (req, res) => {
  const records = getRecords(req);
  carTrips.ensureCarTrips(records);
  const includeDeleted = String(req.query.includeDeleted || "") === "1";
  const list = includeDeleted
    ? records.carTrips || []
    : (records.carTrips || []).filter((t) => t && !t.deletedAt);
  const fy = req.query.financialYear || records.profile?.financialYear || getCurrentFinancialYear();
  res.json({
    trips: list,
    method: carTrips.normalizeMethod(records.profile?.carClaimMethod),
    help: {
      cents_per_km: carTrips.ATO_CENTS_HELP,
      logbook: carTrips.ATO_LOGBOOK_HELP,
    },
    centsPreview: carTrips.centsClaimPreview(records, fy),
  });
});

api.post("/car-trips", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in before recording car trips." });
    return;
  }
  const records = getRecords(req);
  const body = { ...(req.body || {}) };
  if (!body.method && records.profile && records.profile.carClaimMethod) {
    body.method = records.profile.carClaimMethod;
  }
  const result = carTrips.createTrip(records, body, { username: sessionUsername(req) });
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  if (result.trip.method === carTrips.METHODS.CENTS) {
    carTrips.syncCentsTripExpense(records, result.trip, {
      storageAddExpense: (recs, payload) => storage.addExpense(recs, payload),
    });
  }
  persist(req);
  res.json({ trip: result.trip });
});

api.post("/car-trips/:id/destinations", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in before updating car trips." });
    return;
  }
  const records = getRecords(req);
  const result = carTrips.addDestination(records, req.params.id, req.body || {});
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  persist(req);
  res.json({ trip: result.trip });
});

api.post("/car-trips/:id/close", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in before closing car trips." });
    return;
  }
  const records = getRecords(req);
  const result = carTrips.closeTrip(records, req.params.id, req.body || {}, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  persist(req);
  res.json({ trip: result.trip });
});

api.put("/car-trips/:id", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in before editing car trips." });
    return;
  }
  const records = getRecords(req);
  const result = carTrips.updateTrip(records, req.params.id, req.body || {});
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  if (result.trip.method === carTrips.METHODS.CENTS && result.trip.status === "closed") {
    carTrips.syncCentsTripExpense(records, result.trip, {
      storageAddExpense: (recs, payload) => storage.addExpense(recs, payload),
      storageUpdate: (recs, id, patch) => updateExpense(recs, id, patch),
    });
  }
  persist(req);
  res.json({ trip: result.trip });
});

api.post("/car-trips/reconcile", (req, res) => {
  const records = getRecords(req);
  const ids = (req.body && req.body.ids) || [];
  const result = carTrips.reconcileTrips(records, ids, { username: sessionUsername(req) });
  if (result.updated.length) {
    for (const trip of result.updated) {
      if (trip.expenseId) {
        reconcileEntries(records, "expense", [trip.expenseId], {
          username: sessionUsername(req),
        });
      }
    }
    persist(req);
  }
  res.json({
    ok: true,
    updated: result.updated.length,
    skipped: result.skipped,
    notFound: result.notFound,
    trips: result.updated,
  });
});

api.post("/car-trips/unreconcile", (req, res) => {
  const records = getRecords(req);
  const ids = (req.body && req.body.ids) || [];
  const result = carTrips.unreconcileTrips(records, ids, { username: sessionUsername(req) });
  if (result.updated.length) persist(req);
  res.json({ ok: true, updated: result.updated.length, trips: result.updated });
});

api.delete("/car-trips/:id", (req, res) => {
  const records = getRecords(req);
  const result = carTrips.softDeleteTrip(records, req.params.id, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    const status = result.code === "reconciled" ? 409 : result.code === "not_found" ? 404 : 400;
    res.status(status).json({ ok: false, error: result.error, code: result.code });
    return;
  }
  carTrips.softDeleteLinkedExpense(records, result.trip, {
    softDeleteEntry,
    username: sessionUsername(req),
  });
  persist(req);
  res.json({ ok: true, softDeleted: true, trip: result.trip });
});

api.post("/car-trips/:id/restore", (req, res) => {
  const records = getRecords(req);
  const result = carTrips.restoreTrip(records, req.params.id, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    res.status(result.code === "not_found" ? 404 : 400).json({ ok: false, error: result.error, code: result.code });
    return;
  }
  if (result.trip.expenseId) {
    restoreEntry(records, "expense", result.trip.expenseId, {
      username: sessionUsername(req),
    });
  }
  persist(req);
  res.json({ ok: true, trip: result.trip });
});


// --- Summary / report / forecast ----------------------------------------
api.get("/summary", (req, res) => {
  const records = getActiveRecords(req);
  const fy = req.query.financialYear || records.profile.financialYear;
  const summary = summariseFor(req, records, profileFor(records, fy));
  // Visual-only doughnut totals from uploaded remittance / payslip PAYG lines.
  summary.payslipTaxVisual = payslipTaxVisualFromRecords(records, fy, {
    getFinancialYearForDate,
  });
  res.json(summary);
});

api.get("/report", (req, res) => {
  const raw = getActiveRecords(req);
  const records = productOf(req) === "suite" ? scopedSuiteRecords(raw) : raw;
  const fy = req.query.financialYear || records.profile.financialYear;
  const profile = profileFor(records, fy);
  const report =
    productOf(req) === "suite"
      ? suite.decorateAccountantReport(suite.buildAccountantReport(records, profile))
      : decorateAccountantReport(buildAccountantReport(records, profile));
  if (productOf(req) === "suite") {
    report.summary = suite.summariseYear(records, profile);
  } else {
    applyHistoricalRates(report.summary, records, fy);
  }
  // Keep the ATO schedule mapping in sync with the year-corrected deductions.
  report.atoScheduleMapping = report.summary.expenses.breakdown.map((b) => ({
    schedule: b.atoSchedule,
    category: b.label,
    deductibleAmount: b.deductibleTotal,
    transactionCount: b.count,
  }));
  res.json(report);
});

// Accountant-ready EOFY ledger as a downloadable PDF (Pro).
api.get("/report.pdf", (req, res) => {
  if (!assertProFeature(req, res, "pdf")) return;
  const raw = getActiveRecords(req);
  const records = productOf(req) === "suite" ? scopedSuiteRecords(raw) : raw;
  const fy = req.query.financialYear || records.profile.financialYear;
  const profile = profileFor(records, fy);
  const report =
    productOf(req) === "suite"
      ? suite.decorateAccountantReport(suite.buildAccountantReport(records, profile))
      : decorateAccountantReport(buildAccountantReport(records, profile));
  if (productOf(req) === "suite") {
    report.summary = suite.summariseYear(records, profile);
  } else {
    applyHistoricalRates(report.summary, records, fy);
  }
  report.atoScheduleMapping = report.summary.expenses.breakdown.map((b) => ({
    schedule: b.atoSchedule,
    category: b.label,
    deductibleAmount: b.deductibleTotal,
    transactionCount: b.count,
  }));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${productOf(req) === "suite" ? "gotax" : "haulage"}-eofy-${fy}.pdf"`
  );
  const doc = buildReportPdf(report, records, fy);
  doc.pipe(res);
  doc.end();
});

api.get("/forecast", (req, res) => {
  if (!assertProFeature(req, res, "forecast")) return;
  const records = getActiveRecords(req);
  const manual = {
    mode: req.query.mode,
    projectedIncome: req.query.projectedIncome,
    projectedDeductions: req.query.projectedDeductions,
  };
  const forecast =
    productOf(req) === "suite"
      ? suite.buildForecast(records, records.profile, manual)
      : buildForecast(records, records.profile, manual);
  const fy =
    (req.query.fy && String(req.query.fy)) ||
    (req.query.financialYear && String(req.query.financialYear)) ||
    (records.profile && records.profile.financialYear) ||
    forecast.financialYear;
  const backfilled = backfillOvernightDays(records);
  if (backfilled.updated > 0) persist(req);
  forecast.overnightDays =
    productOf(req) === "suite"
      ? suite.summariseOvernightDays(records, records.profile, fy)
      : summariseOvernightDays(records, records.profile, fy);
  res.json(forecast);
});

/** LAFHA / Travel allowance days claimed vs FY length (planning snapshot). */
api.get("/overnight-days", (req, res) => {
  const records = getActiveRecords(req);
  const fy =
    (req.query.fy && String(req.query.fy)) ||
    (req.query.financialYear && String(req.query.financialYear)) ||
    undefined;
  const backfilled = backfillOvernightDays(records);
  if (backfilled.updated > 0) persist(req);
  const summary =
    productOf(req) === "suite"
      ? suite.summariseOvernightDays(records, records.profile, fy)
      : summariseOvernightDays(records, records.profile, fy);
  summary.backfill = backfilled;
  res.json(summary);
});

// --- Billing / freemium -------------------------------------------------
api.get("/billing/entitlements", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to view your plan." });
    return;
  }
  res.json({
    entitlements: resolveReqEntitlements(req),
    stripeConfigured: billingStripe.stripeConfigured(),
    trialOffer: auth.getTrialOfferStatus(productOf(req)),
  });
});

/** Public: signup plan copy (new profiles start on Free). */
api.get("/billing/trial", (req, res) => {
  res.json(auth.getTrialOfferStatus(productOf(req)));
});

/** @deprecated Alias of /billing/trial (older clients). */
api.get("/billing/founding", (req, res) => {
  res.json(auth.getTrialOfferStatus(productOf(req)));
});

api.post("/billing/checkout", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to upgrade." });
    return;
  }
  try {
    const user = auth.getUserRecord(req.user);
    const interval = billingStripe.normaliseInterval(
      (req.body && (req.body.interval || req.body.planInterval)) || "month"
    );
    const plan = entitlements.normalizeCheckoutPlan(
      (req.body && (req.body.plan || req.body.tier)) || "pro"
    );
    const result = await billingStripe.createCheckoutSession({
      user,
      req,
      interval,
      plan,
      product: productOf(req),
      homePath: suite.publicHomePath(req),
      saveCustomerId: (customerId) => {
        auth.updateBilling(req.user, {
          stripeCustomerId: customerId,
          planUpdatedAt: new Date().toISOString(),
        });
      },
    });
    res.json(result);
  } catch (err) {
    const code = err && err.code;
    const status =
      code === "STRIPE_NOT_CONFIGURED" ? 503 : code === "EMAIL_REQUIRED" ? 400 : 400;
    res.status(status).json({ error: err.message, code: code || "CHECKOUT_FAILED" });
  }
});

api.post("/billing/portal", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to manage billing." });
    return;
  }
  try {
    const user = auth.getUserRecord(req.user);
    const result = await billingStripe.createPortalSession({
      user,
      req,
      homePath: suite.publicHomePath(req),
    });
    res.json(result);
  } catch (err) {
    const code = err && err.code;
    const status =
      code === "STRIPE_NOT_CONFIGURED" || code === "NO_CUSTOMER" ? 400 : 400;
    res.status(status).json({ error: err.message, code: code || "PORTAL_FAILED" });
  }
});

/** Cancel Pro at period end — benefits stay until currentPeriodEnd. */
api.post("/billing/cancel", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to cancel your subscription." });
    return;
  }
  try {
    const user = auth.getUserRecord(req.user);
    const result = await billingStripe.cancelSubscriptionAtPeriodEnd({ user });
    auth.updateBilling(req.user, {
      cancelAtPeriodEnd: user.cancelAtPeriodEnd,
      currentPeriodEnd: user.currentPeriodEnd,
      subscriptionStatus: user.subscriptionStatus,
      plan: user.plan,
      planUpdatedAt: new Date().toISOString(),
    });
    res.json({
      ...result,
      entitlements: resolveReqEntitlements(req),
      message: user.currentPeriodEnd
        ? `Pro stays active until ${new Date(user.currentPeriodEnd).toLocaleDateString("en-AU")}. After that you’ll return to Free.`
        : "Subscription will not renew. You’ll keep Pro until the end of the current billing period.",
    });
  } catch (err) {
    const code = err && err.code;
    const status =
      code === "STRIPE_NOT_CONFIGURED" || code === "NO_SUBSCRIPTION" ? 400 : 400;
    res.status(status).json({ error: err.message, code: code || "CANCEL_FAILED" });
  }
});

/** Resume auto-renewal after a scheduled cancel. */
api.post("/billing/resume", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to resume your subscription." });
    return;
  }
  try {
    const user = auth.getUserRecord(req.user);
    const result = await billingStripe.resumeSubscription({ user });
    auth.updateBilling(req.user, {
      cancelAtPeriodEnd: user.cancelAtPeriodEnd,
      currentPeriodEnd: user.currentPeriodEnd,
      subscriptionStatus: user.subscriptionStatus,
      plan: user.plan,
      planUpdatedAt: new Date().toISOString(),
    });
    res.json({
      ...result,
      entitlements: resolveReqEntitlements(req),
      message: "Auto-renewal is back on — your Pro plan will renew as usual.",
    });
  } catch (err) {
    const code = err && err.code;
    const status =
      code === "STRIPE_NOT_CONFIGURED" || code === "NO_SUBSCRIPTION" ? 400 : 400;
    res.status(status).json({ error: err.message, code: code || "RESUME_FAILED" });
  }
});

// --- Expenses ------------------------------------------------------------
api.post("/expenses/preview", (req, res) => {
  const records = getRecords(req);
  const payload = normalizePayloadDate({ ...(req.body || {}) });
  if (payload.category) payload.category = normalizeExpenseCategoryId(payload.category);
  applyActiveCarWorkUse(records, payload);
  const analysis = expenseAnalysis(req, payload);
  if (payload.workUseFromCarProfile) {
    analysis.workUsePercent = Number(payload.workUsePercent);
    analysis.workUseFromCarProfile = true;
  }
  // Use the year's cents-per-km rate (from the entry's date) so the preview
  // matches how a prior-year car claim will be reconciled.
  if (payload.category === "vehicle_car" && payload.method === "cents_per_km" && payload.date) {
    const fy = getFinancialYearForDate(payload.date);
    const km = Math.min(Number(payload.kilometres) || 0, 5000);
    const deductible = Math.round(km * centsPerKmForYear(fy) * 100) / 100;
    analysis.deductibleAmount = deductible;
    analysis.cappedAmount = deductible;
  }
  res.json(analysis);
});

api.post("/expenses", (req, res) => {
  const records = getRecords(req);
  const body = normalizePayloadDate({ ...(req.body || {}) });
  if (body.category) body.category = normalizeExpenseCategoryId(body.category);
  if (req.user) {
    const account = auth.getUserRecord(req.user) || auth.getUser(req.user);
    applyExpensePresets(body, account);
  }
  applyActiveCarWorkUse(records, body);
  delete body.workUseFromCarProfile;
  if (productOf(req) === "suite") suite.extraEntity.stampActiveEntity(records, body);
  const entry = storage.addExpense(records, body);
  if (productOf(req) === "suite" && body.category === "home_office_hours") {
    const hours = Number(body.hours || body.homeOfficeHours || 0);
    if (hours > 0) entry.hours = hours;
  }
  rememberVendor(records, {
    name: body.vendor || entry.vendor,
    abn: body.vendorAbn || entry.vendorAbn,
    category: body.category || entry.category,
  });
  persist(req);
  res.json({ entry, analysis: expenseAnalysis(req, entry) });
});

api.put("/expenses/:id", (req, res) => {
  const records = getRecords(req);
  const existing = findEntry(records, "expense", req.params.id);
  const gate = assertEditable(existing);
  if (!gate.ok) {
    res.status(gate.code === "not_found" ? 404 : 409).json({ error: gate.error, code: gate.code });
    return;
  }
  const body = normalizePayloadDate({ ...(req.body || {}) });
  if (body.category) body.category = normalizeExpenseCategoryId(body.category);
  const entry = updateExpense(records, req.params.id, body);
  if (productOf(req) === "suite" && entry && (body.hours != null || body.homeOfficeHours != null)) {
    entry.hours = Number(body.hours || body.homeOfficeHours || 0);
  }
  if (!entry) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }
  rememberVendor(records, {
    name: body.vendor != null ? body.vendor : entry.vendor,
    abn: body.vendorAbn != null ? body.vendorAbn : entry.vendorAbn,
    category: body.category || entry.category,
  });
  persist(req);
  res.json({ entry, analysis: expenseAnalysis(req, entry) });
});

/** Attach a receipt photo/PDF to an unreconciled expense that has none yet. */
api.post("/expenses/:id/attach-receipt", (req, res) => {
  if (!req.user) {
    res.status(401).json({
      error: "Log in to your profile before attaching a receipt.",
    });
    return;
  }
  if (!assertCanUpload(req, res)) return;
  const records = getRecords(req);
  const body = req.body || {};
  const result = attachReceiptToEntry(records, "expense", req.params.id, {
    dataUrl: body.imageBase64 || body.dataUrl,
    mimeType: body.mimeType,
    filename: body.filename,
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  persist(req);
  res.json({
    entry: result.entry,
    receipt: {
      id: result.receipt.id,
      filename: result.receipt.filename,
      mimeType: result.receipt.mimeType,
      purpose: result.receipt.purpose,
      hasImage: Boolean(result.receipt.imagePath),
    },
    analysis: expenseAnalysis(req, result.entry),
  });
});

api.post("/expenses/reconcile", (req, res) => {
  const records = getRecords(req);
  const ids = (req.body && req.body.ids) || [];
  const result = reconcileEntries(records, "expense", ids, { username: sessionUsername(req) });
  if (result.updated.length) persist(req);
  res.json({
    ok: true,
    updated: result.updated.length,
    skipped: result.skipped,
    notFound: result.notFound,
    entries: result.updated,
  });
});

api.delete("/expenses/:id", (req, res) => {
  const records = getRecords(req);
  const result = softDeleteEntry(records, "expense", req.params.id, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    const status = result.code === "reconciled" ? 409 : result.code === "not_found" ? 404 : 400;
    res.status(status).json({ ok: false, error: result.error, code: result.code });
    return;
  }
  persist(req);
  res.json({ ok: true, softDeleted: true });
});

/** Owner restore — soft-deleted expenses can leave gallery photos with no ledger row. */
api.post("/expenses/:id/restore", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in to restore an expense." });
    return;
  }
  const records = getRecords(req);
  const result = restoreEntry(records, "expense", req.params.id, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 400;
    res.status(status).json({ ok: false, error: result.error, code: result.code });
    return;
  }
  if (!result.alreadyActive) persist(req);
  res.json({ ok: true, entry: result.entry, alreadyActive: Boolean(result.alreadyActive) });
});
api.post("/income", (req, res) => {
  const records = getRecords(req);
  const body = normalizePayloadDate(sanitizeIncomeFields({ ...(req.body || {}) }));
  if (body.type) body.type = normalizeIncomeTypeId(body.type);
  if (productOf(req) === "suite") suite.extraEntity.stampActiveEntity(records, body);
  const entry = storage.addIncome(records, body);
  attachTravelAllowanceToIncome(entry, body, null);
  attachIncomeTaxWithheld(entry, body, null);
  persist(req);
  res.json({ entry });
});

api.put("/income/:id", (req, res) => {
  const records = getRecords(req);
  const existing = findEntry(records, "income", req.params.id);
  const gate = assertEditable(existing);
  if (!gate.ok) {
    res.status(gate.code === "not_found" ? 404 : 409).json({ error: gate.error, code: gate.code });
    return;
  }
  const body = normalizePayloadDate(sanitizeIncomeFields({ ...(req.body || {}) }));
  if (body.type) body.type = normalizeIncomeTypeId(body.type);
  const entry = updateIncome(records, req.params.id, body);
  if (!entry) {
    res.status(404).json({ error: "Income not found." });
    return;
  }
  attachIncomeTaxWithheld(entry, body, null);
  persist(req);
  res.json({ entry });
});

/** Attach a receipt/payslip photo/PDF to an unreconciled income row that has none yet. */
api.post("/income/:id/attach-receipt", (req, res) => {
  if (!req.user) {
    res.status(401).json({
      error: "Log in to your profile before attaching a receipt.",
    });
    return;
  }
  if (!assertCanUpload(req, res)) return;
  const records = getRecords(req);
  const body = req.body || {};
  const result = attachReceiptToEntry(records, "income", req.params.id, {
    dataUrl: body.imageBase64 || body.dataUrl,
    mimeType: body.mimeType,
    filename: body.filename,
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error, code: result.code });
    return;
  }
  persist(req);
  res.json({
    entry: result.entry,
    receipt: {
      id: result.receipt.id,
      filename: result.receipt.filename,
      mimeType: result.receipt.mimeType,
      purpose: result.receipt.purpose,
      hasImage: Boolean(result.receipt.imagePath),
    },
  });
});

api.post("/income/reconcile", (req, res) => {
  const records = getRecords(req);
  const ids = (req.body && req.body.ids) || [];
  const result = reconcileEntries(records, "income", ids, { username: sessionUsername(req) });
  if (result.updated.length) persist(req);
  res.json({
    ok: true,
    updated: result.updated.length,
    skipped: result.skipped,
    notFound: result.notFound,
    entries: result.updated,
  });
});

api.delete("/income/:id", (req, res) => {
  const records = getRecords(req);
  const result = softDeleteEntry(records, "income", req.params.id, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    const status = result.code === "reconciled" ? 409 : result.code === "not_found" ? 404 : 400;
    res.status(status).json({ ok: false, error: result.error, code: result.code });
    return;
  }
  persist(req);
  res.json({ ok: true, softDeleted: true });
});

/** Owner restore — soft-deleted income can leave gallery photos with no ledger row. */
api.post("/income/:id/restore", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in to restore income." });
    return;
  }
  const records = getRecords(req);
  const result = restoreEntry(records, "income", req.params.id, {
    username: sessionUsername(req),
  });
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 400;
    res.status(status).json({ ok: false, error: result.error, code: result.code });
    return;
  }
  if (!result.alreadyActive) persist(req);
  res.json({ ok: true, entry: result.entry, alreadyActive: Boolean(result.alreadyActive) });
});

// --- Receipts ------------------------------------------------------------
api.post("/receipts/scan", optionalScanMultipart, async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error:
          "Log in to your profile before uploading — receipts and payslips save to your account.",
      });
      return;
    }
    // Check quota before OCR so free users are not charged wait time on a blocked upload.
    if (!assertCanUpload(req, res)) return;
    const records = getRecords(req);
    const upload = normalizeScanUpload(req);
    const { imageBase64, mimeType, filename, purpose } = upload;
    if (!imageBase64) {
      res.status(400).json({ error: "Missing image data." });
      return;
    }
    const ocrPurpose = purpose === "income" ? "income" : "expense";
    const ocrResult = await extractReceiptData(openaiForReq(req), imageBase64, mimeType, filename, {
      purpose: ocrPurpose,
    });

    // For PDFs, capture the FULL document text (the provided extractor only
    // exposes a short preview) so every row of tabular payslips can be labelled.
    const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(filename || "");
    if (isPdf) {
      try {
        const fullText = await extractPdfText(imageBase64);
        if (fullText) ocrResult.rawText = fullText;
      } catch (e) {
        console.warn("PDF full-text extraction failed:", e.message);
      }

      // Scanned / photo PDFs have no text layer, so the text-based extractor
      // above finds no dollar totals. Rasterise the pages and OCR the images so
      // those documents read like a photographed receipt/payslip.
      if (pdfResultNeedsOcr(ocrResult, ocrPurpose)) {
        try {
          const rasterOcr = await ocrPdfViaRaster(imageBase64, { purpose: ocrPurpose });
          if (rasterOcr && !pdfResultNeedsOcr(rasterOcr, ocrPurpose)) {
            const combined = normalizeOcrResult({
              ...ocrResult,
              documentType: ocrPurpose === "income" ? "income" : ocrResult.documentType,
              amount: rasterOcr.amount ?? ocrResult.amount,
              gst: rasterOcr.gst ?? ocrResult.gst,
              grossTotal: rasterOcr.grossTotal ?? ocrResult.grossTotal,
              taxableIncome: rasterOcr.taxableIncome ?? ocrResult.taxableIncome,
              gstAmount: rasterOcr.gstAmount ?? ocrResult.gstAmount,
              netPay: rasterOcr.netPay ?? ocrResult.netPay,
              // The text layer had no total, so its vendor/date/etc. are
              // unreliable (often page markers like "-- 1 of 1 --"). Prefer the
              // values read from the rasterised image.
              date: rasterOcr.date || ocrResult.date || null,
              vendor: rasterOcr.vendor || ocrResult.vendor || "",
              entity: rasterOcr.entity || rasterOcr.vendor || ocrResult.entity || "",
              vendorAbn: rasterOcr.vendorAbn || ocrResult.vendorAbn || "",
              suggestedCategory:
                (rasterOcr.suggestedCategory && rasterOcr.suggestedCategory !== "other_work"
                  ? rasterOcr.suggestedCategory
                  : null) ||
                ocrResult.suggestedCategory ||
                rasterOcr.suggestedCategory,
              suggestedIncomeType:
                ocrResult.suggestedIncomeType || rasterOcr.suggestedIncomeType || null,
              lineItems:
                rasterOcr.lineItems && rasterOcr.lineItems.length
                  ? rasterOcr.lineItems
                  : ocrResult.lineItems,
              candidateAmounts: [
                ...(ocrResult.candidateAmounts || []),
                ...(rasterOcr.candidateAmounts || []),
              ],
              payPeriod: ocrResult.payPeriod || rasterOcr.payPeriod || "",
              rawText: rasterOcr.rawText || ocrResult.rawText || "",
              ocrSource: [ocrResult.ocrSource, "pdf-raster-ocr"]
                .filter(Boolean)
                .join("+"),
              notes: "Read from scanned PDF image. Confirm the total below.",
            });
            Object.assign(ocrResult, combined);
          }
        } catch (e) {
          console.warn("PDF image OCR fallback failed:", e.message);
        }
      }
    }

    // Prefer the supplier/employer ABN and the entity name attached to it
    // (checksum + proximity) before vendor memory runs.
    applyAbnEntityPairing(ocrResult, purpose === "income" ? "income" : "expense");

    // ABN + business name memory: fill vendor/ABN from prior saves and suggest
    // a category (meals, training, …) before compliance/breakdown runs.
    enrichOcrFromVendors(
      ocrResult,
      records.vendors || [],
      purpose === "income" ? "income" : "expense"
    );
    if (purpose !== "income") {
      // Profile "Default expense category" when OCR/vendor left a weak guess.
      if (req.user) {
        const account = auth.getUserRecord(req.user) || auth.getUser(req.user);
        applyOcrCategoryPreset(ocrResult, account);
      }
      if (ocrResult.suggestedCategory) {
        ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory);
      }
    }

    // Enrich: typed component breakdown + ATO compliance assessment.
    const { componentBreakdown, breakdownKind, compliance, payPeriod } =
      productOf(req) === "suite"
        ? suite.analyzeScan(ocrResult, purpose === "income" ? "income" : "expense", records.profile)
        : analyzeScan(ocrResult, purpose === "income" ? "income" : "expense", records.profile);
    ocrResult.componentBreakdown = componentBreakdown;
    ocrResult.compliance = compliance;
    ocrResult.notes = [compliance.summary, ocrResult.notes].filter(Boolean).join(" — ");

    // Surface PAYG / income tax withheld for the dashboard Gross vs Tax doughnut
    // (and so confirm can persist it on the income row). Visual only.
    if (purpose === "income") {
      const withheld = extractTaxWithheld(ocrResult, componentBreakdown);
      if (withheld > 0) {
        ocrResult.taxWithheld = withheld;
        ocrResult.paygWithheld = withheld;
      }
    }

    // Pay period / payment date -> surface in the confirm form and saved entry
    // (so it appears in filing), and expose structured info for the UI panel.
    if (payPeriod) {
      ocrResult.payPeriodInfo = payPeriod;
      if (payPeriod.text && !ocrResult.payPeriod) ocrResult.payPeriod = payPeriod.text;
      const filing = [
        payPeriod.text && payPeriod.from ? `Pay period ${payPeriod.text}` : null,
        payPeriod.paymentDateLabel ? `Paid ${payPeriod.paymentDateLabel}` : null,
        payPeriod.cycleLabel || null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (filing) {
        ocrResult.description = ocrResult.description ? `${ocrResult.description} · ${filing}` : filing;
      }
    }

    // Resolve AU invoice/payment date (prefer labeled dates over YTD/period starts)
    // so the entry lands in the correct financial year.
    applyResolvedDocumentDate(
      ocrResult,
      purpose === "income" ? "income" : "expense",
      payPeriod
    );

    // Income uploads: strip any "cheque" payment-method wording and label with
    // payslip / pay-period terminology (with the pay-period date).
    if (purpose === "income") {
      sanitizeIncomeFields(ocrResult);
      // rawText/preview feed the scan-review "raw text" display, so clean those
      // too (analyzeScan has already consumed rawText above).
      if (typeof ocrResult.rawText === "string") ocrResult.rawText = stripChequeTokens(ocrResult.rawText);
      if (typeof ocrResult.rawTextPreview === "string") {
        ocrResult.rawTextPreview = stripChequeTokens(ocrResult.rawTextPreview);
      }
      ocrResult.description = buildIncomeDescription(ocrResult);
      if (ocrResult.suggestedIncomeType) {
        ocrResult.suggestedIncomeType = normalizeIncomeTypeId(ocrResult.suggestedIncomeType);
      }
      if (ocrResult.type) ocrResult.type = normalizeIncomeTypeId(ocrResult.type);
      // Snapshot Travel / LAFHA from OCR text for LAFHA-days forecast.
      ocrResult.travelAllowance = extractTravelAllowance(ocrResult, {
        date: ocrResult.date,
        financialYear:
          (records.profile && records.profile.financialYear) ||
          getFinancialYearForDate(ocrResult.date || new Date().toISOString().slice(0, 10)),
      });
    } else if (ocrResult.suggestedCategory) {
      ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory);
    }

    const scanPurpose = purpose === "income" ? "income" : "expense";
    let detectedTotals = mergeDetectedTotals(ocrResult, componentBreakdown, scanPurpose);
    if (scanPurpose === "expense") {
      detectedTotals = refineExpenseDetectedTotals(detectedTotals, ocrResult, componentBreakdown);
    } else {
      // Remittances/invoices: prefer net income / net pay over gross for the
      // amount users approve into the ledger (gross stays available as a field).
      detectedTotals = refineIncomeDetectedTotals(detectedTotals, ocrResult, componentBreakdown);
    }
    const primaryTotal = detectedTotals.find((t) => t.primary) || detectedTotals[0];
    // Keep OCR amount fields in sync with the primary detected total for the confirm UI.
    if (primaryTotal && primaryTotal.amount > 0) {
      if (scanPurpose === "expense") {
        ocrResult.amount = primaryTotal.amount;
      } else {
        applyIncomePrimaryToOcr(ocrResult, primaryTotal);
        // Fill missing gross/taxable from OCR only — never from the net primary.
        if (!(Number(ocrResult.grossTotal) > 0) && Number(ocrResult.taxableIncome) > 0) {
          ocrResult.grossTotal = Number(ocrResult.taxableIncome);
        }
        if (!(Number(ocrResult.taxableIncome) > 0) && Number(ocrResult.grossTotal) > 0) {
          ocrResult.taxableIncome = Number(ocrResult.grossTotal);
        }
      }
    } else if (scanPurpose === "expense") {
      // Prefer an empty approve amount over a card-PAN OCR guess ($5822.10).
      ocrResult.amount = null;
    }
    const scanAmount =
      labelAmountFromScan(ocrResult, scanPurpose) ?? (primaryTotal ? primaryTotal.amount : null);
    const labeledName = buildDocumentFilename({
      date: ocrResult.date,
      amount: scanAmount,
      mimeType: mimeType || "image/jpeg",
      originalFilename: filename || "receipt.jpg",
    });

    const forceDuplicate = Boolean(upload.forceDuplicate);
    const duplicateMatches = findDuplicateMatches(
      records,
      ocrResult,
      scanPurpose,
      primaryTotal ? primaryTotal.amount : null
    );
    if (duplicateMatches.length && !forceDuplicate) {
      res.json({
        possibleDuplicate: true,
        message: "possible duplicate detected, do you wish to continue with the upload?",
        matches: duplicateMatches,
        ocrResult,
        detectedTotals,
        componentBreakdown,
        breakdownKind,
        compliance,
        payPeriod: payPeriod || null,
      });
      return;
    }

    const receipt = storage.addReceipt(records, {
      source: "scan",
      purpose: scanPurpose,
      filename: labeledName,
      mimeType: mimeType || "image/jpeg",
      dataUrl: imageBase64,
      ocrResult,
    });
    persist(req);
    res.json({
      receipt: {
        id: receipt.id,
        filename: receipt.filename,
        mimeType: receipt.mimeType,
        purpose: receipt.purpose,
        hasImage: Boolean(receipt.imagePath),
      },
      ocrResult,
      detectedTotals,
      componentBreakdown,
      breakdownKind,
      compliance,
      payPeriod: payPeriod || null,
      possibleDuplicate: false,
      matches: duplicateMatches,
    });
  } catch (err) {
    next(err);
  }
});

// Repair rows saved with the upload date: re-OCR the stored scans and set the
// real invoice date (only for rows still showing the upload day). Returns a
// summary so the UI can report how many were fixed.
api.post("/maintenance/refresh-invoice-dates", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Log in to refresh your document dates." });
      return;
    }
    const records = getRecords(req);
    const result = await refreshInvoiceDatesFromScans(records, { openai });
    records.meta = records.meta || {};
    records.meta.invoiceDateRefreshV1 = true;
    persist(req);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Repair junk/empty vendors on old ledger rows from the attached receipt scan
// (stored OCR text by default; set reOcr:true to re-read the image when needed).
api.post("/maintenance/repair-vendors", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Log in to repair vendor names on your receipts." });
      return;
    }
    const records = getRecords(req);
    const body = req.body || {};
    const dryRun = Boolean(body.dryRun);
    const reOcr = Boolean(body.reOcr);
    const limit = Math.max(0, Math.min(500, Number(body.limit) || 0));
    const result = await repairVendorsFromScans(records, {
      openai,
      dryRun,
      reOcr,
      limit,
    });
    records.meta = records.meta || {};
    records.meta.vendorRepairV1 = true;
    if (!dryRun) persist(req, { reason: "vendor-repair" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

api.post("/receipts/manual", (req, res) => {
  if (!req.user) {
    res.status(401).json({
      error: "Log in to your profile before saving — entries are stored on your account.",
    });
    return;
  }
  if (!assertCanUpload(req, res)) return;
  const records = getRecords(req);
  const body = normalizePayloadDate({ ...(req.body || {}) });
  if (body.category) body.category = normalizeExpenseCategoryId(body.category);
  if (req.user) {
    const account = auth.getUserRecord(req.user) || auth.getUser(req.user);
    applyExpensePresets(body, account);
  }
  const { expense, receipt } = storage.addManualReceipt(records, body);
  // Cash / no-receipt / vending flags (layered; storage.js is verbatim).
  if (body.cashTransaction != null) {
    expense.cashTransaction = Boolean(body.cashTransaction);
    if (receipt && receipt.manual) receipt.manual.cashTransaction = expense.cashTransaction;
  }
  if (body.noReceipt != null) {
    expense.noReceipt = Boolean(body.noReceipt);
    if (receipt && receipt.manual) receipt.manual.noReceipt = expense.noReceipt;
  }
  if (body.vendingMachine != null) {
    expense.vendingMachine = Boolean(body.vendingMachine);
    if (receipt && receipt.manual) receipt.manual.vendingMachine = expense.vendingMachine;
  }
  rememberVendor(records, {
    name: body.vendor || expense.vendor,
    abn: body.vendorAbn || expense.vendorAbn,
    category: body.category || expense.category,
  });
  persist(req);
  res.json({ entry: expense, analysis: expenseAnalysis(req, expense) });
});

api.post("/receipts/:id/confirm", (req, res) => {
  if (!req.user) {
    res.status(401).json({
      error: "Log in to your profile before saving — entries are stored on your account.",
    });
    return;
  }
  const records = getRecords(req);
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const { confirmed, purpose, ...payload } = req.body || {};

  if (!confirmed) {
    // Discard = cancel the upload entirely (remove file + receipt record).
    if (receipt) storage.deleteReceipt(records, receipt.id);
    persist(req);
    res.json({ ok: true, discarded: true });
    return;
  }

  if (purpose === "income") {
    sanitizeIncomeFields(payload);
    normalizePayloadDate(payload);
    if (payload.type) payload.type = normalizeIncomeTypeId(payload.type);
    if (!payload.description) payload.description = buildIncomeDescription(payload);

    // Idempotent confirm: already linked to active income, or restore soft-deleted.
    let existing =
      (receipt?.linkedIncomeId && findEntry(records, "income", receipt.linkedIncomeId)) ||
      (receipt && (records.income || []).find((i) => i && i.receiptId === receipt.id)) ||
      null;
    if (existing && isDeleted(existing)) {
      restoreEntry(records, "income", existing.id, { username: sessionUsername(req) });
      existing = updateIncome(records, existing.id, { ...payload, receiptId: receipt.id }) || existing;
      attachTravelAllowanceToIncome(existing, payload, receipt);
      attachIncomeTaxWithheld(existing, payload, receipt);
      rememberVendor(records, {
        name: payload.entity || payload.vendor || payload.payer || existing.entity,
        abn: payload.vendorAbn || payload.abn || existing.vendorAbn,
      });
      if (receipt) {
        receipt.purpose = "income";
        receipt.linkedIncomeId = existing.id;
        receipt.manual = payload;
        receipt.filename = buildDocumentFilename({
          date: payload.date || existing.date,
          amount: labelAmountFromConfirm(payload, "income"),
          mimeType: receipt.mimeType,
          originalFilename: receipt.filename,
        });
      }
      persist(req);
      res.json({
        entry: existing,
        restored: true,
        receipt: receipt ? { id: receipt.id, filename: receipt.filename, purpose: receipt.purpose } : null,
      });
      return;
    }
    if (existing && !isDeleted(existing)) {
      const entry = updateIncome(records, existing.id, { ...payload, receiptId: receipt?.id || null }) || existing;
      attachTravelAllowanceToIncome(entry, payload, receipt);
      attachIncomeTaxWithheld(entry, payload, receipt);
      if (receipt) {
        receipt.purpose = "income";
        receipt.linkedIncomeId = entry.id;
        receipt.manual = payload;
        receipt.filename = buildDocumentFilename({
          date: payload.date || entry.date,
          amount: labelAmountFromConfirm(payload, "income"),
          mimeType: receipt.mimeType,
          originalFilename: receipt.filename,
        });
      }
      persist(req);
      res.json({
        entry,
        alreadyLinked: true,
        receipt: receipt ? { id: receipt.id, filename: receipt.filename, purpose: receipt.purpose } : null,
      });
      return;
    }

    const incomePayload = { ...payload, receiptId: receipt?.id || null };
    if (productOf(req) === "suite") suite.extraEntity.stampActiveEntity(records, incomePayload);
    const entry = storage.addIncome(records, incomePayload);
    attachTravelAllowanceToIncome(entry, payload, receipt);
    attachIncomeTaxWithheld(entry, payload, receipt);
    rememberVendor(records, {
      name: payload.entity || payload.vendor || payload.payer || entry.entity,
      abn: payload.vendorAbn || payload.abn || entry.vendorAbn,
    });
    if (receipt) {
      receipt.purpose = "income";
      receipt.linkedIncomeId = entry.id;
      receipt.manual = payload;
      receipt.filename = buildDocumentFilename({
        date: payload.date || entry.date,
        amount: labelAmountFromConfirm(payload, "income"),
        mimeType: receipt.mimeType,
        originalFilename: receipt.filename,
      });
    }
    persist(req);
    res.json({ entry, receipt: receipt ? { id: receipt.id, filename: receipt.filename, purpose: receipt.purpose } : null });
    return;
  }

  const expensePayload = normalizePayloadDate({ ...payload, receiptId: receipt?.id || null });
  if (expensePayload.category) {
    expensePayload.category = normalizeExpenseCategoryId(expensePayload.category);
  }
  if (req.user) {
    const account = auth.getUserRecord(req.user) || auth.getUser(req.user);
    applyExpensePresets(expensePayload, account);
  }
  applyActiveCarWorkUse(records, expensePayload);
  delete expensePayload.workUseFromCarProfile;
  if (productOf(req) === "suite") suite.extraEntity.stampActiveEntity(records, expensePayload);
  const entry = storage.addExpense(records, expensePayload);
  rememberVendor(records, {
    name: expensePayload.vendor || entry.vendor,
    abn: expensePayload.vendorAbn || entry.vendorAbn,
    category: expensePayload.category || entry.category,
  });
  if (receipt) {
    receipt.purpose = "expense";
    receipt.linkedExpenseId = entry.id;
    receipt.manual = payload;
    receipt.filename = buildDocumentFilename({
      date: payload.date || entry.date,
      amount: labelAmountFromConfirm(payload, "expense"),
      mimeType: receipt.mimeType,
      originalFilename: receipt.filename,
    });
  }
  persist(req);
  res.json({
    entry,
    analysis: expenseAnalysis(req, entry),
    receipt: receipt ? { id: receipt.id, filename: receipt.filename, purpose: receipt.purpose } : null,
  });
});

api.delete("/receipts/:id", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Log in to delete scanned photos from your profile." });
    return;
  }
  const records = getRecords(req);
  const removed = storage.deleteReceipt(records, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Receipt not found." });
    return;
  }
  persist(req);
  res.json({ ok: true });
});

api.get("/receipts/:id/image", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to view receipt files." });
    return;
  }
  const records = getRecords(req);
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const dataUrl = receipt?.imagePath ? storage.readReceiptImage(receipt.imagePath) : null;
  if (!dataUrl) {
    res.status(404).json({ error: "Receipt image not found." });
    return;
  }
  res.json({ dataUrl });
});

api.get("/receipts/:id/file", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to view receipt files." });
    return;
  }
  const records = getRecords(req);
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const info = receipt?.imagePath ? storage.getReceiptFileInfo(receipt.imagePath) : null;
  if (!info) {
    res.status(404).json({ error: "Receipt file not found." });
    return;
  }
  res.setHeader("Content-Type", info.mime);
  if (req.query.download) {
    const downloadName = String(receipt.filename || info.filename || "document").replace(/"/g, "");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  }
  res.sendFile(info.filePath);
});

function persistPartnershipAccount(user) {
  if (!user || !user.username) return;
  auth.updateBilling(user.username, {
    partnershipOwner: user.partnershipOwner || null,
    partnershipSeatAt: user.partnershipSeatAt || null,
  });
}

function buildSharePack(username, product, financialYear) {
  const records = withActiveLedger(recordsForUser(username, product));
  const scoped = product === "suite" ? scopedSuiteRecords(records) : records;
  const fy = financialYear || (scoped.profile && scoped.profile.financialYear);
  const profile = profileFor(scoped, fy);
  const report =
    product === "suite"
      ? suite.decorateAccountantReport(suite.buildAccountantReport(scoped, profile))
      : decorateAccountantReport(buildAccountantReport(scoped, profile));
  if (product === "suite") {
    report.summary = suite.summariseYear(scoped, profile);
  } else {
    applyHistoricalRates(report.summary, scoped, fy);
  }
  return { records: scoped, report, financialYear: fy, profile };
}

// --- Pro+ extras: share, BAS, year pack, extra entity, partnership --------
api.get("/accountant-share", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to manage accountant share links." });
    return;
  }
  const records = getRecords(req);
  res.json({
    shares: accountantShare.listShares(records).map((s) => ({
      ...s,
      url: accountantShare.publicSharePath(productOf(req), s.token),
    })),
    entitlements: resolveReqEntitlements(req),
  });
});

api.post("/accountant-share", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to create a share link." });
    return;
  }
  if (!assertProPlusFeature(req, res, "share")) return;
  try {
    const prod = productOf(req);
    const records = getRecords(req);
    const owner = ledgerUsername(req.user, prod);
    const share = accountantShare.createShare({
      records,
      username: owner,
      product: prod,
      financialYear: (req.body && (req.body.financialYear || req.body.fy)) || records.profile.financialYear,
      createdBy: sessionUsername(req),
    });
    persist(req, { reason: "accountant-share" });
    res.json({
      share,
      url: accountantShare.publicSharePath(prod, share.token),
    });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code || "SHARE_FAILED" });
  }
});

api.delete("/accountant-share/:token", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to revoke a share link." });
    return;
  }
  if (!assertProPlusFeature(req, res, "share")) return;
  try {
    const result = accountantShare.revokeShare({ records: getRecords(req), token: req.params.token });
    persist(req, { reason: "accountant-share-revoke" });
    res.json(result);
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: err.message, code: err.code || "REVOKE_FAILED" });
  }
});

api.get("/share/:token", (req, res) => {
  const meta = accountantShare.lookupShare(req.params.token);
  if (!meta) {
    res.status(404).json({ error: "This share link is missing, expired or has been revoked." });
    return;
  }
  const pack = buildSharePack(meta.username, meta.product, meta.financialYear);
  res.json({
    readOnly: true,
    financialYear: pack.financialYear,
    profile: {
      name: pack.profile.name || "",
      entityType: pack.profile.entityType || pack.profile.driverType || "",
      employer: pack.profile.employer || pack.profile.tradingName || "",
      occupation: pack.profile.occupation || "",
    },
    report: pack.report,
    product: meta.product,
  });
});

api.get("/bas", (req, res) => {
  if (!assertProPlusFeature(req, res, "bas")) return;
  const records = scopedSuiteRecords(getActiveRecords(req));
  const fy = req.query.financialYear || req.query.fy || records.profile.financialYear;
  const pack = suite.basPack.buildBasPack(records, records.profile, {
    financialYear: fy,
    quarter: req.query.quarter,
  });
  res.json(pack);
});

api.get("/tax-pack", (req, res) => {
  if (!assertProPlusFeature(req, res, "year_compare")) return;
  const raw = getActiveRecords(req);
  const records = productOf(req) === "suite" ? scopedSuiteRecords(raw) : raw;
  const summarise = (recs, profile) =>
    productOf(req) === "suite" ? suite.summariseYear(recs, profile) : summariseYear(recs, profile);
  const pack = yearCompare.buildYearCompare(records, records.profile, {
    years: req.query.years,
    financialYear: req.query.financialYear || req.query.fy || records.profile.financialYear,
    summariseYear: summarise,
  });
  res.json(pack);
});

api.get("/suite/partnership", (req, res) => {
  if (productOf(req) !== "suite") {
    res.status(400).json({ error: "Partnership seats are available on Go Taxation Suite." });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "Sign in to view the partnership seat." });
    return;
  }
  const account = auth.getUser(req.user);
  const records = getRecords(req);
  const owner = ledgerUsername(req.user, "suite");
  res.json({
    ...suite.partnershipSeat.presentSeat(records.profile, owner),
    isOwner: String(owner) === String(req.user),
    isPartner: Boolean(account && account.partnershipOwner),
    entitlements: resolveReqEntitlements(req),
  });
});

api.post("/suite/partnership/invite", (req, res) => {
  if (productOf(req) !== "suite") {
    res.status(400).json({ error: "Partnership seats are available on Go Taxation Suite." });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "Sign in to invite a partner." });
    return;
  }
  if (!assertProPlusFeature(req, res, "partnership")) return;
  try {
    const seat = suite.partnershipSeat.invitePartner({
      ownerUsername: req.user,
      partnerUsername: (req.body && (req.body.username || req.body.partnerUsername)) || "",
      ownerRecords: getRecords(req),
      getUserRecord: (name) => auth.getUserRecord(name),
      saveUser: persistPartnershipAccount,
    });
    persist(req, { reason: "partnership-invite" });
    res.json(seat);
  } catch (err) {
    const status = err.code === "USER_NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: err.message, code: err.code || "INVITE_FAILED" });
  }
});

api.post("/suite/partnership/revoke", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to remove a partner seat." });
    return;
  }
  if (!assertProPlusFeature(req, res, "partnership")) return;
  const owner = ledgerUsername(req.user, "suite");
  if (String(owner) !== String(req.user)) {
    res.status(403).json({ error: "Only the partnership owner can remove the second seat." });
    return;
  }
  const seat = suite.partnershipSeat.revokePartner({
    ownerUsername: req.user,
    ownerRecords: getRecords(req),
    getUserRecord: (name) => auth.getUserRecord(name),
    saveUser: persistPartnershipAccount,
  });
  persist(req, { reason: "partnership-revoke" });
  res.json(seat);
});

api.post("/profile/extra-entity", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to add an extra entity." });
    return;
  }
  if (productOf(req) !== "suite") {
    res.status(400).json({ error: "Extra entities are available on Go Taxation Suite." });
    return;
  }
  if (!assertProPlusFeature(req, res, "extra_entity")) return;
  const records = getRecords(req);
  const profile = suite.ensureProfile(records.profile || {});
  const extras = suite.extraEntity.normalizeExtraEntities(profile.extraEntities);
  if (extras.length >= suite.extraEntity.MAX_EXTRA_ENTITIES && !(req.body && req.body.id)) {
    res.status(400).json({
      error: `Pro+ includes ${suite.extraEntity.MAX_EXTRA_ENTITIES} extra entity on this login.`,
    });
    return;
  }
  const next = suite.extraEntity.normalizeExtraEntity(req.body || {});
  const idx = extras.findIndex((e) => e.id === next.id);
  if (idx >= 0) extras[idx] = next;
  else extras.push(next);
  suite.extraEntity.applyExtraEntities(profile, extras, { replace: true });
  records.profile = storage.updateProfile(records, profile);
  persist(req, { reason: "extra-entity" });
  res.json({ profile: records.profile, extraEntities: records.profile.extraEntities });
});

api.delete("/profile/extra-entity/:id", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to remove an extra entity." });
    return;
  }
  if (!assertProPlusFeature(req, res, "extra_entity")) return;
  const records = getRecords(req);
  const profile = suite.ensureProfile(records.profile || {});
  const extras = suite.extraEntity
    .normalizeExtraEntities(profile.extraEntities)
    .filter((e) => e.id !== req.params.id);
  suite.extraEntity.applyExtraEntities(profile, extras, { replace: true });
  if (profile.activeEntityId === req.params.id) profile.activeEntityId = suite.extraEntity.PRIMARY_ID;
  records.profile = storage.updateProfile(records, profile);
  persist(req, { reason: "extra-entity-remove" });
  res.json({ profile: records.profile, extraEntities: records.profile.extraEntities });
});

// --- Support contact -----------------------------------------------------
api.get("/support/info", (req, res) => {
  const ent = req.user ? resolveReqEntitlements(req) : null;
  res.json({
    email: support.supportInbox(),
    mailConfigured: mail.mailConfigured(),
    priority: Boolean(ent && ent.canPrioritySupport),
    channels: {
      smtp: mail.smtpConfigured(),
      resend: mail.resendConfigured(),
    },
  });
});

api.post("/support/contact", async (req, res) => {
  const checked = support.validateContact(req.body || {});
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const { name, email, phone, message } = checked.data;
  // req.user is the session username string from auth.getSessionUser(), not an object.
  const username = support.sessionUsername(req.user);
  const ent = username ? resolveReqEntitlements(req) : null;
  const priority = Boolean(ent && ent.canPrioritySupport);
  const saved = support.saveContactMessage({ name, email, phone, message, username, priority });
  const inbox = support.supportInbox();
  let mailResult = { sent: false, confirmationSent: false, to: inbox };
  try {
    mailResult = await mail.sendSupportEmail({
      name,
      email,
      phone,
      message,
      username,
      to: inbox,
      priority,
    });
  } catch (err) {
    console.warn("Support email failed:", err && err.message ? err.message : err);
    mailResult = {
      sent: false,
      confirmationSent: false,
      to: inbox,
      error: err && err.message ? err.message : String(err),
    };
  }

  const emailed = Boolean(mailResult.sent);
  const confirmationSent = Boolean(mailResult.confirmationSent);
  let statusMessage;
  if (emailed && confirmationSent) {
    statusMessage =
      "Your support request has been sent to the developer. A confirmation notice was also emailed to you.";
  } else if (emailed) {
    statusMessage =
      "Your support request has been sent to the developer. We’ll reply to the email you provided.";
  } else {
    // Client may still deliver via FormSubmit; keep copy neutral.
    statusMessage =
      "Your request was saved. Connecting to the support inbox…";
  }

  res.json({
    ok: true,
    id: saved.id,
    username,
    emailed,
    confirmationSent,
    channel: mailResult.channel || null,
    needsClientDelivery: !emailed,
    supportEmail: inbox,
    mailto: support.mailtoHref({ name, email, phone, message, priority }),
    priority,
    confirmationText: mail.buildSupportConfirmationText({ name, supportEmail: inbox }),
    message: statusMessage,
    error: mailResult.error || null,
  });
});

app.use("/api/haulage", api);

// --- Go Taxation Suite (general PAYG / sole trader / partnership) ----------
// On the Driver Hub Render service, once SUITE_PUBLIC_URL points at the
// dedicated go-taxation-suite host, /suite must leave this origin so the two
 // products are visibly separate (own URL, disk, and accounts).
function redirectSuiteToSibling(req, res, next) {
  if (suite.isStandaloneSuite()) return next();
  const origin = suite.siblingPublicUrl();
  if (!origin) return next();
  const rest = req.originalUrl || "/suite/";
  const pathPart = rest.startsWith("/suite") ? rest.slice("/suite".length) || "/" : "/";
  res.redirect(302, `${origin}/suite${pathPart === "/" ? "/" : pathPart}`);
}

app.get(["/suite/share/:token", "/haulage/share/:token", "/share/:token"], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "share.html"));
});

app.get(["/suite", "/suite/"], redirectSuiteToSibling, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "suite", "index.html"));
});
app.use("/suite", redirectSuiteToSibling);
app.use("/suite", express.static(path.join(PUBLIC_DIR, "suite")));
app.use("/suite", express.static(PUBLIC_DIR));

// --- Static UI at /haulage (Driver Hub) ---------------------------------
// Dedicated Go Taxation Suite hosts (APP_PRODUCT=suite) send / and /haulage
// to /suite/ so the second Render service is not a truck-driver login.
if (suite.isStandaloneSuite()) {
  app.use("/haulage", (req, res) => {
    const sibling = suite.siblingPublicUrl();
    if (sibling) {
      const rest = req.url && req.url !== "/" ? req.url : "/";
      res.redirect(302, `${sibling}/haulage${rest === "/" ? "/" : rest}`);
      return;
    }
    const rest = req.url && req.url !== "/" ? req.url : "/";
    res.redirect(302, `/suite${rest}`);
  });
} else {
  app.use("/haulage", express.static(PUBLIC_DIR));
  app.get("/haulage", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
}
app.get("/", (_req, res) => res.redirect(302, suite.publicHomePath()));

// Error handler -> friendly JSON (413 for oversized uploads).
app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.too.large") {
    res.status(413).json({ error: "Upload too large." });
    return;
  }
  console.error("Server error:", err && err.message);
  res.status((err && err.status) || 500).json({ error: (err && err.message) || "Server error" });
});

if (process.env.NODE_ENV !== "test") {
  const storage = dataDir.adoptAndBind();
  console.log(
    `Storage: ${storage.dataDir} (source=${storage.source}, mounted=${storage.mounted}, accounts=${storage.accountCount})`
  );
  backup
    .restoreLatestIfStoreEmpty()
    .then((restored) => {
      if (restored && restored.restored) {
        console.log(`Restored profiles from backup ${restored.id} after empty data dir`);
      }
    })
    .catch((err) => {
      console.warn("Startup profile restore skipped:", err.message);
    })
    .finally(() => {
      bootListen();
    });
}

function bootListen() {
  if (process.env.NODE_ENV === "test") return;
  auth.reloadSessionsFromDisk();
  const admin = auth.ensureAdminBootstrap();
  app.listen(PORT, "0.0.0.0", () => {
    if (suite.isStandaloneSuite()) {
      console.log(`Go Taxation Suite (standalone) running at http://localhost:${PORT}/suite/`);
    } else {
      console.log(`Driver Hub / Taxation Hub / Fuel Hub running at http://localhost:${PORT}/haulage/`);
      console.log(`Go Taxation Suite (general ATO) running at http://localhost:${PORT}/suite/`);
    }
    if (admin) console.log(`Primary mod: ${admin.username} (admin panel on Profile tab)`);
    console.log(openai ? "OCR: OpenAI + local Tesseract" : "OCR: local Tesseract / manual fallback (set OPENAI_API_KEY for cloud OCR)");
    backup.startBackupScheduler({
      flushFn: flushAllCachedRecordsToDisk,
      onComplete: notifyBackupComplete,
    });
  });
}

module.exports = { app };
