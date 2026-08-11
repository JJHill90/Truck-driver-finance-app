const fs = require("fs");
const path = require("path");
const express = require("express");

const {
  DRIVER_TYPES,
  getCurrentFinancialYear,
  getCategoryMeta,
} = require("./lib/ato-standards");
const {
  ensureMealsRegistered,
  listMenuCategories,
  listMenuCategoryGroups,
  listSpecialClaimCategories,
  normalizeExpenseCategoryId,
} = require("./lib/expense-menu");
const { listMenuIncomeTypes, normalizeIncomeTypeId } = require("./lib/income-menu");
const { toIsoAusDate, resolveDocumentDate } = require("./lib/aus-date");
const { refineExpenseDetectedTotals } = require("./lib/expense-total");
const { enrichOcrFromVendors, rememberVendor } = require("./lib/vendor-enrichment");
const { applyAbnEntityPairing } = require("./lib/abn-entity");
const { updateExpense, updateIncome } = require("./lib/ledger-edit");
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
const {
  listLicenceClasses,
  getLicenceClassForSalary,
  normalizeLicenceClassId,
} = require("./lib/licence-class");
const { searchTransportEmployers } = require("./lib/transport-employers");
const {
  listDriverRoleDefaults,
  getDriverRoleDefaults,
} = require("./lib/driver-role-defaults");
const storage = require("./lib/storage");
const auth = require("./lib/auth");
const { calcExpenseDeduction, summariseYear, buildAccountantReport } = require("./lib/tax-calculator");

ensureMealsRegistered();
const { buildForecast } = require("./lib/forecast");
const {
  extractReceiptData,
  mergeDetectedTotals,
  normalizeOcrResult,
} = require("./lib/receipt-ocr");
const { analyzeScan } = require("./lib/document-breakdown");
const { extractPdfText } = require("./lib/pdf-text");
const { ocrPdfViaRaster, pdfResultNeedsOcr } = require("./lib/pdf-ocr");
const { applyHistoricalRates, centsPerKmForYear } = require("./lib/historical-rates");
const { getFinancialYearForDate } = require("./lib/ato-standards");
const { buildReportPdf } = require("./lib/report-pdf");
const {
  buildDocumentFilename,
  labelAmountFromScan,
  labelAmountFromConfirm,
} = require("./lib/document-label");
const { findDuplicateMatches } = require("./lib/duplicate-receipt");
const { refreshInvoiceDatesFromScans } = require("./lib/receipt-date-refresh");
const {
  sanitizeIncomeFields,
  buildIncomeDescription,
  stripChequeTokens,
} = require("./lib/income-labels");
const support = require("./lib/support");
const { HAULAGE_PR_NUMBER, formatVersionLabel } = require("./lib/version");
const { corsMiddleware, sessionCookieFlags } = require("./lib/cors");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_COOKIE = "haulage_sid";

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
// Each signed-in user gets their own data/users/<name>.json; anonymous visitors
// share a guest store so the app still works before creating a profile.
const recordsCache = new Map();
function fileForUser(user) {
  return user ? auth.recordsFileFor(user) : storage.DEFAULT_FILE;
}
function recordsForUser(user) {
  const key = user || "__guest__";
  if (!recordsCache.has(key)) {
    const rec = storage.loadRecords(fileForUser(user));
    recordsCache.set(key, rec);
    maybeBackfillInvoiceDates(rec, user);
  }
  return recordsCache.get(key);
}

// One-time (per user) background repair of rows saved with the upload date
// instead of the scanned invoice date. Flagged so it runs once and never
// overrides dates the user later edits; runs in the background so it does not
// block the first request. Re-runnable on demand via the maintenance endpoint.
function maybeBackfillInvoiceDates(records, user) {
  if (!records || (records.meta && records.meta.invoiceDateRefreshV1)) return;
  records.meta = records.meta || {};
  records.meta.invoiceDateRefreshV1 = true; // set first to avoid re-entry
  refreshInvoiceDatesFromScans(records, { openai })
    .then((result) => {
      if (result.updated || records.meta) storage.saveRecords(records, fileForUser(user));
      if (result.updated) {
        console.log(
          `Invoice-date backfill for ${user || "guest"}: updated ${result.updated} of ${result.scanned} rescanned.`
        );
      }
    })
    .catch((err) => console.warn("Invoice-date backfill failed:", err.message));
}
function getRecords(req) {
  return recordsForUser(req.user);
}
function persist(req) {
  storage.saveRecords(getRecords(req), fileForUser(req.user));
}
/** Records view for tax/UI — soft-deleted ledger rows excluded. */
function getActiveRecords(req) {
  return withActiveLedger(getRecords(req));
}
function profileFor(records, financialYear) {
  return { ...records.profile, financialYear: financialYear || records.profile.financialYear };
}
function sessionUsername(req) {
  return req.user ? String(req.user) : null;
}
function loadTargetUserRecords(username) {
  const user = auth.getUser(username);
  if (!user) return null;
  const file = auth.recordsFileFor(user.username);
  let records;
  if (recordsCache.has(user.username)) {
    records = recordsCache.get(user.username);
  } else {
    records = storage.loadRecords(file);
    recordsCache.set(user.username, records);
  }
  return { user, records, file };
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
function buildAlerts(records) {
  const alerts = [];
  const profile = records.profile || {};
  const summary = summariseYear(records, profile);

  const missing = [];
  if (!profile.name) missing.push("name");
  if (!profile.employer) missing.push("employer");
  if (!Number(profile.annualSalary)) missing.push("annual salary");
  if (missing.length) {
    alerts.push({ level: "info", message: `Complete your profile: ${missing.join(", ")}.` });
  }

  const needReceipt = (records.expenses || []).filter((e) => {
    const meta = getCategoryMeta(e.category);
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
      message: `No income recorded${profile.financialYear ? ` for FY ${profile.financialYear}` : ""} yet — scan a payslip or remittance.`,
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
app.use(express.json({ limit: "30mb" }));

const api = express.Router();

// Resolve the signed-in user (if any) from the session cookie.
api.use((req, _res, next) => {
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

// --- Auth ----------------------------------------------------------------
const mail = require("./lib/mail");

api.post("/auth/password-strength", (req, res) => {
  const { password, username } = req.body || {};
  res.json(auth.scorePassword(password, username));
});

api.post("/auth/register", (req, res) => {
  const { username, password, email, presets } = req.body || {};
  try {
    const user = auth.registerUser(username, password, presets, email);
    const token = auth.createSession(user.username);
    recordsForUser(user.username); // initialise their store
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
    };
    // On the 10th failed attempt, email a recovery link (once) when the
    // account has an email on file.
    if (result.needsRecovery && result.failedLoginCount === auth.MAX_FAILED_LOGINS) {
      err = `Too many failed sign-ins (${auth.MAX_FAILED_LOGINS}). Check your email for a recovery link, or use “Forgot username / password?”.`;
      payload.error = err;
      try {
        const existing = auth.getUser(username);
        if (existing && existing.email) {
          const recovery = auth.createRecoveryTokenForEmail(existing.email);
          if (recovery.found) {
            const base = mail.appBaseUrl(req);
            const resetUrl = `${base}/haulage/recover.html?token=${encodeURIComponent(recovery.token)}`;
            const sent = await mail.sendRecoveryEmail({
              to: recovery.email,
              username: recovery.username,
              resetUrl,
            });
            // Same-origin path so the UI can continue without SMTP / email delivery.
            const recoveryPath = `/haulage/recover.html?token=${encodeURIComponent(recovery.token)}`;
            payload.emailSent = Boolean(sent.sent);
            if (!sent.sent) {
              payload.recoveryUrl = recoveryPath;
              payload.devRecoveryUrl = resetUrl; // legacy alias
              payload.devUsername = recovery.username;
            }
          }
        } else {
          err =
            `Too many failed sign-ins (${auth.MAX_FAILED_LOGINS}). This profile has no email — ask the primary mod for a password reset, or recover once an email is on file.`;
          payload.error = err;
        }
      } catch (mailErr) {
        console.warn("[auth] auto-recovery email failed:", mailErr.message);
      }
    } else if (result.needsRecovery) {
      err = `Too many failed sign-ins (${auth.MAX_FAILED_LOGINS}). Use “Forgot username / password?” to recover via email.`;
      payload.error = err;
    }
    res.status(401).json(payload);
    return;
  }
  const user = result.user;
  const token = auth.createSession(user.username);
  recordsForUser(user.username);
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
  res.json({ user: req.user ? auth.getUser(req.user) : null });
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
      const recoveryPath = `/haulage/recover.html?token=${encodeURIComponent(recovery.token)}`;
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
    recordsForUser(user.username);
    setSessionCookie(res, session, req);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get("/alerts", (req, res) => {
  const alerts = buildAlerts(getActiveRecords(req));
  const user = req.user ? auth.getUser(req.user) : null;
  if (user) alerts.push(...auth.accountAlerts(user));
  res.json({ alerts, user: user || req.user || null });
});

const { summariseLafha } = require("./lib/lafha");

api.get("/lafha", (req, res) => {
  const records = getRecords(req);
  res.json(summariseLafha(records.profile || {}, records.income || []));
});

api.get("/version", (_req, res) => {
  res.json({
    prNumber: HAULAGE_PR_NUMBER,
    label: formatVersionLabel(HAULAGE_PR_NUMBER),
  });
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

function userRecordsSummary(username) {
  const file = auth.recordsFileFor(username);
  // Prefer the live in-memory store when this user is already cached (e.g. they
  // are signed in elsewhere on this process); otherwise read from disk.
  const records = recordsCache.has(username)
    ? recordsCache.get(username)
    : storage.loadRecords(file);
  const fy = records.profile?.financialYear || getCurrentFinancialYear();
  const summary = summariseYear(records, profileFor(records, fy));
  applyHistoricalRates(summary, records, fy);
  return {
    user: auth.getUser(username),
    profile: records.profile || {},
    counts: {
      expenses: (records.expenses || []).length,
      income: (records.income || []).length,
      receipts: (records.receipts || []).length,
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
      const snap = userRecordsSummary(u.username);
      return { ...u, counts: snap.counts, totals: snap.totals, profileName: snap.profile.name || "" };
    } catch (err) {
      return { ...u, counts: { expenses: 0, income: 0, receipts: 0 }, totals: null, error: err.message };
    }
  });
  res.json({ users, admin: auth.getUser(req.user) });
});

api.get("/admin/users/:username", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const target = auth.getUser(req.params.username);
  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const file = auth.recordsFileFor(target.username);
  const records = recordsCache.has(target.username)
    ? recordsCache.get(target.username)
    : storage.loadRecords(file);
  const fy = req.query.financialYear || records.profile?.financialYear || getCurrentFinancialYear();
  const summary = summariseYear(records, profileFor(records, fy));
  applyHistoricalRates(summary, records, fy);

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

  res.json({
    user: target,
    profile: records.profile || {},
    expenses,
    income,
    deletedExpenses,
    deletedIncome,
    receipts,
    vendors: storage.listVendors(records),
    summary: summariseYear(withActiveLedger(records), profileFor(records, fy)),
  });
});

/** Admin: unlock reconciled ledger rows for a driver. */
api.post("/admin/users/:username/:type(expenses|income)/unreconcile", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username);
  if (!loaded) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const type = req.params.type === "income" ? "income" : "expense";
  const result = unreconcileEntries(loaded.records, type, (req.body && req.body.ids) || [], {
    username: sessionUsername(req),
  });
  if (result.updated.length) storage.saveRecords(loaded.records, loaded.file);
  res.json({ ok: true, updated: result.updated.length, notFound: result.notFound });
});

/** Admin: restore soft-deleted ledger rows for a driver. */
api.post("/admin/users/:username/:type(expenses|income)/restore", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username);
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
  if (restored.length) storage.saveRecords(loaded.records, loaded.file);
  res.json({ ok: true, restored: restored.length, entries: restored, errors });
});

/** Admin: force soft-delete (including reconciled) for cleanup. */
api.post("/admin/users/:username/:type(expenses|income)/soft-delete", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const loaded = loadTargetUserRecords(req.params.username);
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
  if (deleted.length) storage.saveRecords(loaded.records, loaded.file);
  res.json({ ok: true, deleted: deleted.length, entries: deleted, errors });
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
    if (fs.existsSync(recordsFile)) fs.unlinkSync(recordsFile);
    res.json({ ok: true, username: target.username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Reference data ------------------------------------------------------
api.get("/standards", (_req, res) => {
  res.json({
    categories: listMenuCategories(),
    specialClaimCategories: listSpecialClaimCategories(),
    categoryGroups: listMenuCategoryGroups(),
    incomeTypes: listMenuIncomeTypes(),
    driverTypes: DRIVER_TYPES,
    licenceClasses: listLicenceClasses(),
    driverRoleDefaults: listDriverRoleDefaults(),
    financialYear: getCurrentFinancialYear(),
  });
});

// Predictive employer names for the Profile "Employer" field (open to guests).
api.get("/employers", (req, res) => {
  const q = String(req.query.q || req.query.query || "");
  const limit = Number(req.query.limit) || 12;
  res.json({
    query: q,
    employers: searchTransportEmployers(q, { limit }),
  });
});

api.get("/driver-role-defaults", (req, res) => {
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
  const records = withActiveLedger(full);
  const receipts = (records.receipts || []).map((r) => ({
    ...r,
    hasImage: Boolean(r.imagePath),
    dataUrl: undefined,
  }));
  res.json({ ...records, receipts, vendors: storage.listVendors(full) });
});

// --- Profile -------------------------------------------------------------
api.put("/profile", (req, res) => {
  const records = getRecords(req);
  const body = { ...(req.body || {}) };
  if (body.annualSalary != null && body.annualSalary !== "") {
    body.annualSalary = Number(body.annualSalary);
  }
  // Licence class (LR/MR → MC) follows annual salary when omitted or invalid.
  const fromSalary = getLicenceClassForSalary(body.annualSalary ?? records.profile?.annualSalary);
  const normalised = normalizeLicenceClassId(body.licenceClass);
  body.licenceClass = normalised || fromSalary;
  // Drop legacy Band 1/2/3 UI field if a client still posts it — ATO travel
  // bands are derived from salary in the tax calculator, not stored here.
  delete body.salaryBand;
  const profile = storage.updateProfile(records, body);
  persist(req);
  res.json({ profile });
});

// --- Summary / report / forecast ----------------------------------------
api.get("/summary", (req, res) => {
  const records = getActiveRecords(req);
  const fy = req.query.financialYear || records.profile.financialYear;
  const summary = summariseYear(records, profileFor(records, fy));
  applyHistoricalRates(summary, records, fy); // year-correct brackets/levies/rates
  res.json(summary);
});

api.get("/report", (req, res) => {
  const records = getActiveRecords(req);
  const fy = req.query.financialYear || records.profile.financialYear;
  const report = buildAccountantReport(records, profileFor(records, fy));
  applyHistoricalRates(report.summary, records, fy);
  // Keep the ATO schedule mapping in sync with the year-corrected deductions.
  report.atoScheduleMapping = report.summary.expenses.breakdown.map((b) => ({
    schedule: b.atoSchedule,
    category: b.label,
    deductibleAmount: b.deductibleTotal,
    transactionCount: b.count,
  }));
  res.json(report);
});

// Accountant-ready EOFY ledger as a downloadable PDF.
api.get("/report.pdf", (req, res) => {
  const records = getActiveRecords(req);
  const fy = req.query.financialYear || records.profile.financialYear;
  const report = buildAccountantReport(records, profileFor(records, fy));
  applyHistoricalRates(report.summary, records, fy);
  report.atoScheduleMapping = report.summary.expenses.breakdown.map((b) => ({
    schedule: b.atoSchedule,
    category: b.label,
    deductibleAmount: b.deductibleTotal,
    transactionCount: b.count,
  }));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="haulage-eofy-${fy}.pdf"`);
  const doc = buildReportPdf(report, records, fy);
  doc.pipe(res);
  doc.end();
});

api.get("/forecast", (req, res) => {
  const records = getActiveRecords(req);
  const manual = {
    mode: req.query.mode,
    projectedIncome: req.query.projectedIncome,
    projectedDeductions: req.query.projectedDeductions,
  };
  res.json(buildForecast(records, records.profile, manual));
});

// --- Expenses ------------------------------------------------------------
api.post("/expenses/preview", (req, res) => {
  const payload = normalizePayloadDate({ ...(req.body || {}) });
  if (payload.category) payload.category = normalizeExpenseCategoryId(payload.category);
  const analysis = calcExpenseDeduction(payload);
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
  const entry = storage.addExpense(records, body);
  rememberVendor(records, {
    name: body.vendor || entry.vendor,
    abn: body.vendorAbn || entry.vendorAbn,
    category: body.category || entry.category,
  });
  persist(req);
  res.json({ entry, analysis: calcExpenseDeduction(entry) });
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
  res.json({ entry, analysis: calcExpenseDeduction(entry) });
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

// --- Income --------------------------------------------------------------
api.post("/income", (req, res) => {
  const records = getRecords(req);
  const body = normalizePayloadDate(sanitizeIncomeFields({ ...(req.body || {}) }));
  if (body.type) body.type = normalizeIncomeTypeId(body.type);
  const entry = storage.addIncome(records, body);
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
  persist(req);
  res.json({ entry });
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

// --- Receipts ------------------------------------------------------------
api.post("/receipts/scan", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error:
          "Log in to your profile before uploading — receipts and payslips save to your account.",
      });
      return;
    }
    const records = getRecords(req);
    const { imageBase64, mimeType, filename, purpose } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: "Missing image data." });
      return;
    }
    const ocrPurpose = purpose === "income" ? "income" : "expense";
    const ocrResult = await extractReceiptData(openai, imageBase64, mimeType, filename, {
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
    if (purpose !== "income" && ocrResult.suggestedCategory) {
      ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory);
    }

    // Enrich: typed component breakdown + ATO compliance assessment.
    const { componentBreakdown, breakdownKind, compliance, payPeriod } = analyzeScan(
      ocrResult,
      purpose === "income" ? "income" : "expense",
      records.profile
    );
    ocrResult.componentBreakdown = componentBreakdown;
    ocrResult.compliance = compliance;
    ocrResult.notes = [compliance.summary, ocrResult.notes].filter(Boolean).join(" — ");

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
    } else if (ocrResult.suggestedCategory) {
      ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory);
    }

    const scanPurpose = purpose === "income" ? "income" : "expense";
    let detectedTotals = mergeDetectedTotals(ocrResult, componentBreakdown, scanPurpose);
    if (scanPurpose === "expense") {
      detectedTotals = refineExpenseDetectedTotals(detectedTotals, ocrResult, componentBreakdown);
    }
    const primaryTotal = detectedTotals.find((t) => t.primary) || detectedTotals[0];
    // Keep OCR amount fields in sync with the primary detected total for the confirm UI.
    if (primaryTotal && primaryTotal.amount > 0) {
      if (scanPurpose === "expense") {
        ocrResult.amount = primaryTotal.amount;
      } else {
        if (!(Number(ocrResult.grossTotal) > 0)) ocrResult.grossTotal = primaryTotal.amount;
        if (!(Number(ocrResult.taxableIncome) > 0)) ocrResult.taxableIncome = primaryTotal.amount;
        if (!(Number(ocrResult.amount) > 0)) {
          ocrResult.amount = Number(ocrResult.netPay) > 0 ? ocrResult.netPay : primaryTotal.amount;
        }
      }
    }
    const scanAmount =
      labelAmountFromScan(ocrResult, scanPurpose) ?? (primaryTotal ? primaryTotal.amount : null);
    const labeledName = buildDocumentFilename({
      date: ocrResult.date,
      amount: scanAmount,
      mimeType: mimeType || "image/jpeg",
      originalFilename: filename || "receipt.jpg",
    });

    const forceDuplicate = Boolean((req.body || {}).forceDuplicate);
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

api.post("/receipts/manual", (req, res) => {
  if (!req.user) {
    res.status(401).json({
      error: "Log in to your profile before saving — entries are stored on your account.",
    });
    return;
  }
  const records = getRecords(req);
  const body = normalizePayloadDate({ ...(req.body || {}) });
  if (body.category) body.category = normalizeExpenseCategoryId(body.category);
  const { expense, receipt } = storage.addManualReceipt(records, body);
  // Cash / no-receipt flags (layered; storage.js is verbatim).
  if (body.cashTransaction != null) {
    expense.cashTransaction = Boolean(body.cashTransaction);
    if (receipt && receipt.manual) receipt.manual.cashTransaction = expense.cashTransaction;
  }
  if (body.noReceipt != null) {
    expense.noReceipt = Boolean(body.noReceipt);
    if (receipt && receipt.manual) receipt.manual.noReceipt = expense.noReceipt;
  }
  rememberVendor(records, {
    name: body.vendor || expense.vendor,
    abn: body.vendorAbn || expense.vendorAbn,
    category: body.category || expense.category,
  });
  persist(req);
  res.json({ entry: expense, analysis: calcExpenseDeduction(expense) });
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
    const entry = storage.addIncome(records, { ...payload, receiptId: receipt?.id || null });
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
    analysis: calcExpenseDeduction(entry),
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

// --- Support contact -----------------------------------------------------
api.get("/support/info", (_req, res) => {
  res.json({
    email: support.supportInbox(),
    mailConfigured: mail.mailConfigured(),
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
  const saved = support.saveContactMessage({ name, email, phone, message, username });
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
    mailto: support.mailtoHref({ name, email, phone, message }),
    confirmationText: mail.buildSupportConfirmationText({ name, supportEmail: inbox }),
    message: statusMessage,
    error: mailResult.error || null,
  });
});

app.use("/api/haulage", api);

// --- Static UI at /haulage ----------------------------------------------
app.use("/haulage", express.static(PUBLIC_DIR));
app.get("/haulage", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/", (_req, res) => res.redirect("/haulage/"));

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
  const admin = auth.ensureAdminBootstrap();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DriverHub / FinanceHub running at http://localhost:${PORT}/haulage/`);
    if (admin) console.log(`Primary mod: ${admin.username} (admin panel on Profile tab)`);
    console.log(openai ? "OCR: OpenAI + local Tesseract" : "OCR: local Tesseract / manual fallback (set OPENAI_API_KEY for cloud OCR)");
  });
}

module.exports = { app };
