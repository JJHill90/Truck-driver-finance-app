/**
 * Build download/display filenames for scanned receipts & invoices.
 * Format: "DD.MM.YY AUD$123.45.ext"
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Parse common date strings into { day, month, year2 }. */
function parseDateParts(dateInput) {
  if (dateInput == null || dateInput === "") return null;

  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return {
      day: dateInput.getDate(),
      month: dateInput.getMonth() + 1,
      year2: dateInput.getFullYear() % 100,
    };
  }

  const s = String(dateInput).trim();

  // YYYY-MM-DD (ISO / HTML date input)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return { day: Number(m[3]), month: Number(m[2]), year2: Number(m[1]) % 100 };
  }

  // DD.MM.YY or DD.MM.YYYY or DD/MM/YY or DD/MM/YYYY
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return { day, month, year2: year % 100 };
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return {
      day: d.getDate(),
      month: d.getMonth() + 1,
      year2: d.getFullYear() % 100,
    };
  }

  return null;
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
