// First-party fallback: OCR image-only / scanned PDFs.
//
// The provided OCR pipeline (lib/receipt-ocr.js) only reads a PDF's *text
// layer* via pdf-parse. Receipts and payslips that are photos or scans saved
// as PDFs have no text layer, so they came back with no dollar totals ("can't
// read the file"). This module rasterises each page with MuPDF (a pure-WASM
// dependency, no native build) and runs the existing Tesseract extractor on the
// rendered image so those documents read like any other photo.

const { extractTotalsWithTesseract } = require("./local-receipt-ocr");
const { parseMoney, uniqueAmounts } = require("./receipt-ocr-money");

// MuPDF ships as an ESM module with top-level await, so it cannot be require()d
// from this CommonJS codebase. Load it lazily via dynamic import and cache the
// promise so the server still boots instantly when no PDF is ever scanned.
let mupdfPromise = null;
function loadMupdf() {
  if (!mupdfPromise) {
    mupdfPromise = import("mupdf").then((m) => m.default || m);
  }
  return mupdfPromise;
}

function toBuffer(dataUrlOrBase64) {
  const raw = String(dataUrlOrBase64 || "");
  const b64 = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(b64, "base64");
}

/** Tight budgets so Android scan requests never wait on a 4-page zoom-2 Tesseract run. */
const INCOME_RASTER_OPTS = { maxPages: 1, zoom: 1.25, timeoutMs: 15000 };
const EXPENSE_RASTER_OPTS = { maxPages: 2, zoom: 1.5, timeoutMs: 20000 };
const PAGE_OCR_TIMEOUT_MS = 18000;

function rasterOptionsFor(purpose) {
  return purpose === "income" ? INCOME_RASTER_OPTS : EXPENSE_RASTER_OPTS;
}

/** Render up to `maxPages` PDF pages to PNG base64 strings. */
async function renderPdfPagesToPng(dataUrlOrBase64, { maxPages = 4, zoom = 2, timeoutMs = 45000 } = {}) {
  const buffer = toBuffer(dataUrlOrBase64);
  if (!buffer.length) return [];

  const work = async () => {
    const mupdf = await loadMupdf();
    const doc = mupdf.Document.openDocument(buffer, "application/pdf");
    try {
      const pageCount = Math.min(doc.countPages(), maxPages);
      const pngs = [];
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        let pix = null;
        try {
          pix = page.toPixmap(
            mupdf.Matrix.scale(zoom, zoom),
            mupdf.ColorSpace.DeviceRGB,
            false,
            true
          );
          pngs.push(Buffer.from(pix.asPNG()).toString("base64"));
        } finally {
          if (pix && typeof pix.destroy === "function") pix.destroy();
          if (page && typeof page.destroy === "function") page.destroy();
        }
      }
      return pngs;
    } finally {
      if (doc && typeof doc.destroy === "function") doc.destroy();
    }
  };

  let timer = null;
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`PDF rasterise timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resultAmount(result, purpose) {
  if (!result) return 0;
  if (purpose === "income") {
    return (
      parseMoney(result.grossTotal) ||
      parseMoney(result.amount) ||
      parseMoney(result.taxableIncome) ||
      parseMoney(result.netPay) ||
      0
    );
  }
  return parseMoney(result.amount) || 0;
}

/** Keep the page result that read best; union candidate amounts + raw text. */
function mergePageResults(base, next, purpose) {
  if (!base) return next;
  if (!next) return base;
  const winner = resultAmount(next, purpose) > resultAmount(base, purpose) ? next : base;
  const other = winner === next ? base : next;
  return {
    ...winner,
    candidateAmounts: uniqueAmounts([
      ...(winner.candidateAmounts || []),
      ...(other.candidateAmounts || []),
    ]),
    lineItems: [...(winner.lineItems || []), ...(other.lineItems || [])],
    rawText: [winner.rawText, other.rawText].filter(Boolean).join("\n"),
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Rasterise a PDF and OCR its pages. Returns a normalised-shape OCR result
 * (same fields as the Tesseract image path) or null if nothing could be read.
 */
async function ocrPdfViaRaster(dataUrlOrBase64, opts = {}) {
  const purpose = opts.purpose === "income" ? "income" : "expense";
  const budget = rasterOptionsFor(purpose);
  let pages;
  try {
    pages = await renderPdfPagesToPng(dataUrlOrBase64, {
      maxPages: opts.maxPages ?? budget.maxPages,
      zoom: opts.zoom ?? budget.zoom,
      timeoutMs: opts.timeoutMs ?? budget.timeoutMs,
    });
  } catch (err) {
    console.warn("PDF rasterise failed:", err.message);
    return null;
  }
  if (!pages.length) return null;

  let merged = null;
  for (const b64 of pages) {
    let pageResult = null;
    try {
      pageResult = await withTimeout(
        extractTotalsWithTesseract(`data:image/png;base64,${b64}`, "image/png", { purpose }),
        PAGE_OCR_TIMEOUT_MS,
        "PDF page OCR"
      );
    } catch (err) {
      console.warn("PDF page OCR failed:", err.message);
    }
    merged = mergePageResults(merged, pageResult, purpose);
    // First page with a solid amount is almost always the whole story.
    if (resultAmount(merged, purpose) > 0) break;
  }

  if (!merged) return null;
  return { ...merged, ocrSource: "pdf-raster-ocr" };
}

/** Does a text-layer PDF result still need an image OCR pass? */
function pdfResultNeedsOcr(result, purpose) {
  if (!result) return true;
  return resultAmount(result, purpose) <= 0;
}

/**
 * True when the PDF already has a real text layer (digital payslip / invoice).
 * Page chrome like "-- 1 of 1 --" is not enough — those still need raster OCR.
 */
function hasUsablePdfTextLayer(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length < 80) return false;
  const withoutChrome = compact
    .replace(/[-–—]{1,3}\s*\d+\s*(?:of|\/)\s*\d+\s*[-–—]{1,3}/gi, " ")
    .replace(/\bpage\s*\d+(?:\s*(?:of|\/)\s*\d+)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutChrome.length < 80) return false;
  const words = withoutChrome.match(/[A-Za-z]{3,}/g) || [];
  return words.length >= 8;
}

/**
 * Raster + Tesseract only for image-only / scanned PDFs.
 * Digital PDFs with a usable text layer stay on the fast pdf-parse path even
 * when labelled dollar totals were not found (driver enters them).
 */
function shouldRasterPdf(result, purpose, text) {
  if (!pdfResultNeedsOcr(result, purpose)) return false;
  const layer = text || (result && result.rawText) || "";
  if (hasUsablePdfTextLayer(layer)) return false;
  return true;
}

/**
 * Fold a raster/Tesseract pass into an existing text-layer OCR result.
 * Prefers raster vendor/date/totals when the text layer had no labelled amount.
 */
function mergeRasterIntoOcr(ocrResult, rasterOcr, purpose) {
  const base = ocrResult && typeof ocrResult === "object" ? ocrResult : {};
  if (!rasterOcr || typeof rasterOcr !== "object") return { ...base, ocrPending: false };
  return {
    ...base,
    documentType: purpose === "income" ? "income" : base.documentType,
    amount: rasterOcr.amount ?? base.amount,
    gst: rasterOcr.gst ?? base.gst,
    grossTotal: rasterOcr.grossTotal ?? base.grossTotal,
    taxableIncome: rasterOcr.taxableIncome ?? base.taxableIncome,
    gstAmount: rasterOcr.gstAmount ?? base.gstAmount,
    netPay: rasterOcr.netPay ?? base.netPay,
    date: rasterOcr.date || base.date || null,
    vendor: rasterOcr.vendor || base.vendor || "",
    entity: rasterOcr.entity || rasterOcr.vendor || base.entity || "",
    vendorAbn: rasterOcr.vendorAbn || base.vendorAbn || "",
    suggestedCategory:
      (rasterOcr.suggestedCategory && rasterOcr.suggestedCategory !== "other_work"
        ? rasterOcr.suggestedCategory
        : null) ||
      base.suggestedCategory ||
      rasterOcr.suggestedCategory,
    suggestedIncomeType: base.suggestedIncomeType || rasterOcr.suggestedIncomeType || null,
    lineItems:
      rasterOcr.lineItems && rasterOcr.lineItems.length ? rasterOcr.lineItems : base.lineItems,
    candidateAmounts: [...(base.candidateAmounts || []), ...(rasterOcr.candidateAmounts || [])],
    payPeriod: base.payPeriod || rasterOcr.payPeriod || "",
    rawText: rasterOcr.rawText || base.rawText || "",
    ocrSource: [base.ocrSource, "pdf-raster-ocr"].filter(Boolean).join("+"),
    notes: rasterOcr.notes || base.notes || "Read from scanned PDF image. Confirm the total below.",
    ocrPending: false,
  };
}

module.exports = {
  INCOME_RASTER_OPTS,
  EXPENSE_RASTER_OPTS,
  PAGE_OCR_TIMEOUT_MS,
  rasterOptionsFor,
  ocrPdfViaRaster,
  renderPdfPagesToPng,
  pdfResultNeedsOcr,
  hasUsablePdfTextLayer,
  shouldRasterPdf,
  mergeRasterIntoOcr,
};
