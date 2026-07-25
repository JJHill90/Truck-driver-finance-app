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

/** Render up to `maxPages` PDF pages to PNG base64 strings. */
async function renderPdfPagesToPng(dataUrlOrBase64, { maxPages = 4, zoom = 2 } = {}) {
  const buffer = toBuffer(dataUrlOrBase64);
  if (!buffer.length) return [];

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

/**
 * Rasterise a PDF and OCR its pages. Returns a normalised-shape OCR result
 * (same fields as the Tesseract image path) or null if nothing could be read.
 */
async function ocrPdfViaRaster(dataUrlOrBase64, { purpose = "expense" } = {}) {
  let pages;
  try {
    pages = await renderPdfPagesToPng(dataUrlOrBase64);
  } catch (err) {
    console.warn("PDF rasterise failed:", err.message);
    return null;
  }
  if (!pages.length) return null;

  let merged = null;
  for (const b64 of pages) {
    let pageResult = null;
    try {
      pageResult = await extractTotalsWithTesseract(
        `data:image/png;base64,${b64}`,
        "image/png",
        { purpose }
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

module.exports = {
  ocrPdfViaRaster,
  renderPdfPagesToPng,
  pdfResultNeedsOcr,
};
