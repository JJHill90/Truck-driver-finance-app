/**
 * Build download/display filenames for scanned receipts & invoices.
 * Format: "DD.MM.YY AUD$123.45.ext"
 */
const { toIsoAusDate } = require("./aus-date");

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Parse common date strings into { day, month, year2 }. */
function parseDateParts(dateInput) {
  if (dateInput == null || dateInput === "") return null;

  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    const iso = toIsoAusDate(dateInput);
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return { day: d, month: m, year2: y % 100 };
  }

  const iso = toIsoAusDate(dateInput);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return { day: d, month: m, year2: y % 100 };
}

/** Format date as DD.MM.YY */
function formatLabelDate(dateInput) {
  const parts = parseDateParts(dateInput);
  if (!parts) return null;
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  return `${pad2(parts.day)}.${pad2(parts.month)}.${pad2(parts.year2)}`;
}

/** Format amount as AUD$123.45 (always 2 decimals, no thousands separators). */
function formatAudAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `AUD$${n.toFixed(2)}`;
}

function extensionFrom(mimeType, originalFilename) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("heic") || mime.includes("heif")) return ".heic";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";

  const fromName = originalFilename && String(originalFilename).match(/(\.[a-z0-9]+)$/i);
  if (fromName) return fromName[1].toLowerCase();
  return ".jpg";
}

/**
 * Build a labeled filename: "DD.MM.YY AUD$123.45.pdf"
 * Falls back to originalFilename (or a generic name) when date/amount missing.
 */
function buildDocumentFilename({ date, amount, mimeType, originalFilename } = {}) {
  const d = formatLabelDate(date);
  const a = formatAudAmount(amount);
  const ext = extensionFrom(mimeType, originalFilename);

  if (d && a) return `${d} ${a}${ext}`;
  if (d) return `${d}${ext}`;
  if (a) return `${a}${ext}`;

  if (originalFilename && String(originalFilename).trim()) {
    return String(originalFilename).trim();
  }
  return `document${ext}`;
}

/** Pick the dollar amount used for labeling (income prefers gross). */
function labelAmountFromScan(ocrResult, purpose) {
  const o = ocrResult || {};
  if (purpose === "income") {
    const n = o.grossTotal ?? o.amount ?? o.taxableIncome ?? o.netPay;
    return n != null && Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null;
  }
  const n = o.amount;
  return n != null && Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null;
}

function labelAmountFromConfirm(payload, purpose) {
  const p = payload || {};
  if (purpose === "income") {
    const n = p.grossTotal ?? p.amount;
    return n != null && Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null;
  }
  const n = p.amount;
  return n != null && Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null;
}

module.exports = {
  formatLabelDate,
  formatAudAmount,
  extensionFrom,
  buildDocumentFilename,
  labelAmountFromScan,
  labelAmountFromConfirm,
};
