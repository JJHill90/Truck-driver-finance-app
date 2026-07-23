const path = require("path");
const express = require("express");

const {
  listCategories,
  listIncomeTypes,
  CATEGORY_GROUPS,
  DRIVER_TYPES,
  getCurrentFinancialYear,
  getCategoryMeta,
} = require("./lib/ato-standards");
const storage = require("./lib/storage");
const auth = require("./lib/auth");
const { calcExpenseDeduction, summariseYear, buildAccountantReport } = require("./lib/tax-calculator");
const { buildForecast } = require("./lib/forecast");
const { extractReceiptData, getDetectedTotals } = require("./lib/receipt-ocr");
const { analyzeScan } = require("./lib/document-breakdown");
const { extractPdfText } = require("./lib/pdf-text");
const { applyHistoricalRates, centsPerKmForYear } = require("./lib/historical-rates");
const { getFinancialYearForDate } = require("./lib/ato-standards");
const { buildReportPdf } = require("./lib/report-pdf");
const {
  buildDocumentFilename,
  labelAmountFromScan,
  labelAmountFromConfirm,
} = require("./lib/document-label");
const { findDuplicateMatches } = require("./lib/duplicate-receipt");

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
  if (!recordsCache.has(key)) recordsCache.set(key, storage.loadRecords(fileForUser(user)));
  return recordsCache.get(key);
}
function getRecords(req) {
  return recordsForUser(req.user);
}
function persist(req) {
  storage.saveRecords(getRecords(req), fileForUser(req.user));
}
function profileFor(records, financialYear) {
  return { ...records.profile, financialYear: financialYear || records.profile.financialYear };
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

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Merge the typed component breakdown with the provided detected totals,
// preferring typed labels, de-duplicating by amount, keeping one primary.
function mergeDetectedTotals(ocrResult, components) {
  const out = [];
  const seen = new Set();
  const add = (label, amount, primary) => {
    const v = Number(amount);
    if (!(v > 0)) return;
    const key = v.toFixed(2);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, amount: v, primary: Boolean(primary) });
  };
  for (const c of components) {
    if (c.detected !== false) add(c.label, c.amount, false);
  }
  const hasBreakdown = components.length > 0;
  for (const t of getDetectedTotals(ocrResult)) {
    if (hasBreakdown && /^Detected \$/.test(t.label)) continue;
    add(t.label, t.amount, t.primary);
  }
  if (out.length && !out.some((t) => t.primary)) out[0].primary = true;
  let primarySeen = false;
  for (const t of out) {
    if (t.primary) {
      if (primarySeen) t.primary = false;
      else primarySeen = true;
    }
  }
  return out;
}

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
app.use(express.json({ limit: "30mb" }));

const api = express.Router();

// Resolve the signed-in user (if any) from the session cookie.
api.use((req, _res, next) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  req.sessionToken = token || null;
  req.user = auth.getSessionUser(token);
  next();
});

// --- Auth ----------------------------------------------------------------
api.post("/auth/register", (req, res) => {
  const { username, password, presets } = req.body || {};
  try {
    const user = auth.registerUser(username, password, presets);
    const token = auth.createSession(user.username);
    recordsForUser(user.username); // initialise their store
    setSessionCookie(res, token);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = auth.verifyUser(username, password);
  if (!user) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  const token = auth.createSession(user.username);
  recordsForUser(user.username);
  setSessionCookie(res, token);
  res.json({ user });
});

api.post("/auth/logout", (req, res) => {
  auth.destroySession(req.sessionToken);
  clearSessionCookie(res);
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

api.get("/alerts", (req, res) => {
  res.json({ alerts: buildAlerts(getRecords(req)), user: req.user || null });
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

  res.json({
    user: target,
    profile: records.profile || {},
    expenses: records.expenses || [],
    income: records.income || [],
    receipts,
    vendors: storage.listVendors(records),
    summary,
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

// --- Reference data ------------------------------------------------------
api.get("/standards", (_req, res) => {
  res.json({
    categories: listCategories(),
    categoryGroups: CATEGORY_GROUPS,
    incomeTypes: listIncomeTypes(),
    driverTypes: DRIVER_TYPES,
    financialYear: getCurrentFinancialYear(),
  });
});

api.get("/records", (req, res) => {
  const records = getRecords(req);
  res.json({ ...records, vendors: storage.listVendors(records) });
});

// --- Profile -------------------------------------------------------------
api.put("/profile", (req, res) => {
  const records = getRecords(req);
  const profile = storage.updateProfile(records, req.body || {});
  persist(req);
  res.json({ profile });
});

// --- Summary / report / forecast ----------------------------------------
api.get("/summary", (req, res) => {
  const records = getRecords(req);
  const fy = req.query.financialYear || records.profile.financialYear;
  const summary = summariseYear(records, profileFor(records, fy));
  applyHistoricalRates(summary, records, fy); // year-correct brackets/levies/rates
  res.json(summary);
});

api.get("/report", (req, res) => {
  const records = getRecords(req);
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
  const records = getRecords(req);
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
  const records = getRecords(req);
  const manual = {
    mode: req.query.mode,
    projectedIncome: req.query.projectedIncome,
    projectedDeductions: req.query.projectedDeductions,
  };
  res.json(buildForecast(records, records.profile, manual));
});

// --- Expenses ------------------------------------------------------------
api.post("/expenses/preview", (req, res) => {
  const payload = req.body || {};
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
  const entry = storage.addExpense(records, req.body || {});
  persist(req);
  res.json({ entry, analysis: calcExpenseDeduction(entry) });
});

api.delete("/expenses/:id", (req, res) => {
  const records = getRecords(req);
  const removed = storage.deleteEntry(records, "expense", req.params.id);
  persist(req);
  res.json({ ok: removed });
});

// --- Income --------------------------------------------------------------
api.post("/income", (req, res) => {
  const records = getRecords(req);
  const entry = storage.addIncome(records, req.body || {});
  persist(req);
  res.json({ entry });
});

api.delete("/income/:id", (req, res) => {
  const records = getRecords(req);
  const removed = storage.deleteEntry(records, "income", req.params.id);
  persist(req);
  res.json({ ok: removed });
});

// --- Receipts ------------------------------------------------------------
api.post("/receipts/scan", async (req, res, next) => {
  try {
    const records = getRecords(req);
    const { imageBase64, mimeType, filename, purpose } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: "Missing image data." });
      return;
    }
    const ocrResult = await extractReceiptData(openai, imageBase64, mimeType, filename, {
      purpose: purpose === "income" ? "income" : "expense",
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
      if (payPeriod.paymentDate && !ocrResult.date) ocrResult.date = payPeriod.paymentDate;
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

    const scanPurpose = purpose === "income" ? "income" : "expense";
    const detectedTotals = mergeDetectedTotals(ocrResult, componentBreakdown);
    const primaryTotal = detectedTotals.find((t) => t.primary) || detectedTotals[0];
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

api.post("/receipts/manual", (req, res) => {
  const records = getRecords(req);
  const { expense } = storage.addManualReceipt(records, req.body || {});
  persist(req);
  res.json({ entry: expense, analysis: calcExpenseDeduction(expense) });
});

api.post("/receipts/:id/confirm", (req, res) => {
  const records = getRecords(req);
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const { confirmed, purpose, ...payload } = req.body || {};

  if (!confirmed) {
    if (receipt) receipt.manual = payload;
    persist(req);
    res.json({ ok: true, discarded: true });
    return;
  }

  if (purpose === "income") {
    const entry = storage.addIncome(records, { ...payload, receiptId: receipt?.id || null });
    if (receipt) {
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
    res.json({ entry, receipt: receipt ? { id: receipt.id, filename: receipt.filename } : null });
    return;
  }

  const entry = storage.addExpense(records, { ...payload, receiptId: receipt?.id || null });
  if (receipt) {
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
  res.json({ entry, analysis: calcExpenseDeduction(entry), receipt: receipt ? { id: receipt.id, filename: receipt.filename } : null });
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
    console.log(`Haulage finance app running at http://localhost:${PORT}/haulage/`);
    if (admin) console.log(`Primary mod: ${admin.username} (admin panel on Profile tab)`);
    console.log(openai ? "OCR: OpenAI + local Tesseract" : "OCR: local Tesseract / manual fallback (set OPENAI_API_KEY for cloud OCR)");
  });
}

module.exports = { app };
