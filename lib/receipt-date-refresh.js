// First-party maintenance helper: re-derive the *invoice* date for scanned
// income/expense entries and repair rows that were saved with the upload date.
//
// Why this is needed: when a document is scanned, the ledger entry's date comes
// from the confirm form, which defaults to "today" when OCR did not detect a
// date. Documents scanned before the image-only-PDF OCR fix therefore have the
// upload date instead of the real invoice date, and their stored
// receipt.ocrResult has no date to backfill from — so we must re-OCR the stored
// file (text layer + rasterised image for scanned PDFs) to recover the date.
//
// Safety: a row is only changed when its current date still equals the upload
// day (i.e. it was defaulted), so dates a user set on purpose are never touched.

const storage = require("./storage");
const { extractReceiptData } = require("./receipt-ocr");
const { ocrPdfViaRaster, pdfResultNeedsOcr } = require("./pdf-ocr");
const { buildDocumentFilename, labelAmountFromConfirm } = require("./document-label");

/** Accept only a real YYYY-MM-DD calendar date. */
function validDate(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function dayOf(value) {
  return String(value || "").slice(0, 10);
}

function isPdfReceipt(receipt) {
  const mt = String(receipt.mimeType || "").toLowerCase();
  return mt.includes("pdf") || /\.pdf$/i.test(receipt.filename || "");
}

/** Re-OCR a stored receipt file and return its detected invoice date (or null). */
async function invoiceDateFromScan(receipt, purpose, openai) {
  // Prefer a date already captured at scan time.
  const existing = validDate(receipt.ocrResult && receipt.ocrResult.date);
  if (existing) return existing;
  if (!receipt.imagePath) return null;

  const dataUrl = storage.readReceiptImage(receipt.imagePath);
  if (!dataUrl) return null;
  const mimeType = receipt.mimeType || (isPdfReceipt(receipt) ? "application/pdf" : "image/jpeg");

  let ocr = null;
  try {
    ocr = await extractReceiptData(openai, dataUrl, mimeType, receipt.filename || "", { purpose });
  } catch {
    ocr = null;
  }
  let date = validDate(ocr && ocr.date);

  // Scanned / image-only PDFs have no text layer; rasterise + OCR to get a date.
  if (!date && isPdfReceipt(receipt) && (!ocr || pdfResultNeedsOcr(ocr, purpose) || !ocr.date)) {
    try {
      const raster = await ocrPdfViaRaster(dataUrl, { purpose });
      date = validDate(raster && raster.date);
    } catch {
      /* ignore */
    }
  }

  if (date) {
    receipt.ocrResult = receipt.ocrResult || {};
    if (!validDate(receipt.ocrResult.date)) receipt.ocrResult.date = date;
  }
  return date;
}

/**
 * Repair upload-dated rows across income + expenses.
 * @returns {Promise<{scanned:number, updated:number, details:Array}>}
 */
async function refreshInvoiceDatesFromScans(records, { openai = null } = {}) {
  const receiptsById = new Map((records.receipts || []).map((r) => [r.id, r]));
  let scanned = 0;
  let updated = 0;
  const details = [];

  async function processEntry(entry, purpose) {
    if (!entry || !entry.receiptId) return;
    const receipt = receiptsById.get(entry.receiptId);
    if (!receipt) return;

    // Only repair rows still showing the upload day — never override a date the
    // user chose themselves.
    const uploadDay = dayOf(receipt.createdAt || entry.createdAt);
    if (!uploadDay || entry.date !== uploadDay) return;

    const hadDate = validDate(receipt.ocrResult && receipt.ocrResult.date);
    if (!hadDate) scanned += 1;
    const invoiceDate = await invoiceDateFromScan(receipt, purpose, openai);
    if (!invoiceDate || invoiceDate === entry.date) return;

    const from = entry.date;
    if (!entry.uploadedDate) entry.uploadedDate = from;
    entry.date = invoiceDate;
    updated += 1;

    // Keep the stored file label (DD.MM.YY AUD$…) in step with the fixed date.
    try {
      const amount = labelAmountFromConfirm(entry, purpose);
      receipt.filename = buildDocumentFilename({
        date: invoiceDate,
        amount,
        mimeType: receipt.mimeType,
        originalFilename: receipt.filename,
      });
    } catch {
      /* labelling is best-effort */
    }
    details.push({ id: entry.id, purpose, from, to: invoiceDate });
  }

  for (const entry of records.income || []) await processEntry(entry, "income");
  for (const entry of records.expenses || []) await processEntry(entry, "expense");

  return { scanned, updated, details };
}

module.exports = { refreshInvoiceDatesFromScans, invoiceDateFromScan, validDate };
