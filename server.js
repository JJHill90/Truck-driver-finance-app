const path = require("path");
const express = require("express");

const {
  listCategories,
  listIncomeTypes,
  CATEGORY_GROUPS,
  DRIVER_TYPES,
  getCurrentFinancialYear,
} = require("./lib/ato-standards");
const storage = require("./lib/storage");
const { calcExpenseDeduction, summariseYear, buildAccountantReport } = require("./lib/tax-calculator");
const { buildForecast } = require("./lib/forecast");
const { extractReceiptData, getDetectedTotals } = require("./lib/receipt-ocr");
const { analyzeScan } = require("./lib/document-breakdown");
const { extractPdfText } = require("./lib/pdf-text");

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
  // When we have a labelled breakdown, drop the generic "Detected $X" candidate
  // rows (e.g. YTD figures) so the review list shows meaningful labels only.
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

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

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

// Single in-memory record set persisted to data/driver-records.json after mutations.
const records = storage.loadRecords();

const app = express();
app.use(express.json({ limit: "30mb" }));

const api = express.Router();

function profileFor(financialYear) {
  return { ...records.profile, financialYear: financialYear || records.profile.financialYear };
}

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

api.get("/records", (_req, res) => {
  res.json({ ...records, vendors: storage.listVendors(records) });
});

// --- Profile -------------------------------------------------------------
api.put("/profile", (req, res) => {
  const profile = storage.updateProfile(records, req.body || {});
  storage.saveRecords(records);
  res.json({ profile });
});

// --- Summary / report / forecast ----------------------------------------
api.get("/summary", (req, res) => {
  const fy = req.query.financialYear || records.profile.financialYear;
  res.json(summariseYear(records, profileFor(fy)));
});

api.get("/report", (req, res) => {
  const fy = req.query.financialYear || records.profile.financialYear;
  res.json(buildAccountantReport(records, profileFor(fy)));
});

api.get("/forecast", (req, res) => {
  const manual = {
    mode: req.query.mode,
    projectedIncome: req.query.projectedIncome,
    projectedDeductions: req.query.projectedDeductions,
  };
  res.json(buildForecast(records, records.profile, manual));
});

// --- Expenses ------------------------------------------------------------
api.post("/expenses/preview", (req, res) => {
  res.json(calcExpenseDeduction(req.body || {}));
});

api.post("/expenses", (req, res) => {
  const entry = storage.addExpense(records, req.body || {});
  storage.saveRecords(records);
  res.json({ entry, analysis: calcExpenseDeduction(entry) });
});

api.delete("/expenses/:id", (req, res) => {
  const removed = storage.deleteEntry(records, "expense", req.params.id);
  storage.saveRecords(records);
  res.json({ ok: removed });
});

// --- Income --------------------------------------------------------------
api.post("/income", (req, res) => {
  const entry = storage.addIncome(records, req.body || {});
  storage.saveRecords(records);
  res.json({ entry });
});

api.delete("/income/:id", (req, res) => {
  const removed = storage.deleteEntry(records, "income", req.params.id);
  storage.saveRecords(records);
  res.json({ ok: removed });
});

// --- Receipts ------------------------------------------------------------
api.post("/receipts/scan", async (req, res, next) => {
  try {
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
    const { componentBreakdown, breakdownKind, compliance } = analyzeScan(
      ocrResult,
      purpose === "income" ? "income" : "expense",
      records.profile
    );
    ocrResult.componentBreakdown = componentBreakdown;
    ocrResult.compliance = compliance;
    // Surface the compliance summary in the existing confirm UI note.
    ocrResult.notes = [compliance.summary, ocrResult.notes].filter(Boolean).join(" — ");

    const receipt = storage.addReceipt(records, {
      source: "scan",
      filename: filename || "receipt.jpg",
      mimeType: mimeType || "image/jpeg",
      dataUrl: imageBase64,
      ocrResult,
    });
    storage.saveRecords(records);
    res.json({
      receipt: {
        id: receipt.id,
        filename: receipt.filename,
        mimeType: receipt.mimeType,
        hasImage: Boolean(receipt.imagePath),
      },
      ocrResult,
      detectedTotals: mergeDetectedTotals(ocrResult, componentBreakdown),
      componentBreakdown,
      breakdownKind,
      compliance,
    });
  } catch (err) {
    next(err);
  }
});

api.post("/receipts/manual", (req, res) => {
  const { expense } = storage.addManualReceipt(records, req.body || {});
  storage.saveRecords(records);
  res.json({ entry: expense, analysis: calcExpenseDeduction(expense) });
});

api.post("/receipts/:id/confirm", (req, res) => {
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const { confirmed, purpose, ...payload } = req.body || {};

  if (!confirmed) {
    if (receipt) receipt.manual = payload;
    storage.saveRecords(records);
    res.json({ ok: true, discarded: true });
    return;
  }

  if (purpose === "income") {
    const entry = storage.addIncome(records, { ...payload, receiptId: receipt?.id || null });
    if (receipt) {
      receipt.linkedIncomeId = entry.id;
      receipt.manual = payload;
    }
    storage.saveRecords(records);
    res.json({ entry });
    return;
  }

  const entry = storage.addExpense(records, { ...payload, receiptId: receipt?.id || null });
  if (receipt) {
    receipt.linkedExpenseId = entry.id;
    receipt.manual = payload;
  }
  storage.saveRecords(records);
  res.json({ entry, analysis: calcExpenseDeduction(entry) });
});

api.get("/receipts/:id/image", (req, res) => {
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const dataUrl = receipt?.imagePath ? storage.readReceiptImage(receipt.imagePath) : null;
  if (!dataUrl) {
    res.status(404).json({ error: "Receipt image not found." });
    return;
  }
  res.json({ dataUrl });
});

api.get("/receipts/:id/file", (req, res) => {
  const receipt = (records.receipts || []).find((r) => r.id === req.params.id);
  const info = receipt?.imagePath ? storage.getReceiptFileInfo(receipt.imagePath) : null;
  if (!info) {
    res.status(404).json({ error: "Receipt file not found." });
    return;
  }
  res.setHeader("Content-Type", info.mime);
  if (req.query.download) {
    res.setHeader("Content-Disposition", `attachment; filename="${receipt.filename || info.filename}"`);
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
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Haulage finance app running at http://localhost:${PORT}/haulage/`);
    console.log(openai ? "OCR: OpenAI + local Tesseract" : "OCR: local Tesseract / manual fallback (set OPENAI_API_KEY for cloud OCR)");
  });
}

module.exports = { app };
