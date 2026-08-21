/**
 * Retroactively populate overnightDays / travelAllowanceAmount on income
 * rows from linked receipt OCR text (or description notes) when missing or
 * when an earlier extract mistook HOURS for a dollar amount.
 */
const {
  extractTravelAllowance,
  applyTravelAllowanceToEntry,
} = require("./travel-allowance-extract");

function isDeleted(entry) {
  return Boolean(entry && (entry.deletedAt || entry.deleted));
}

function looksLikeHoursMistakenForDollars(entry) {
  const amt = Number(entry && entry.travelAllowanceAmount);
  if (!(amt > 0) || amt > 31) return false;
  // Tiny "amount" with no days, or amount_div_rate that produced 0 nights.
  const days = Number(entry && entry.overnightDays) || 0;
  return days <= 0 || String(entry.overnightDaysSource || "") === "amount_div_rate";
}

function needsOvernightBackfill(entry) {
  if (!entry || isDeleted(entry)) return false;
  const days = Number(entry.overnightDays) || 0;
  if (days > 0 && !looksLikeHoursMistakenForDollars(entry)) return false;
  if (looksLikeHoursMistakenForDollars(entry)) return true;
  return days <= 0;
}

function textBlobForEntry(entry, receipt) {
  const ocr = (receipt && receipt.ocrResult) || {};
  return [
    ocr.rawText,
    ocr.rawTextPreview,
    ocr.description,
    typeof entry.payPeriod === "string" ? entry.payPeriod : null,
    entry.payPeriod && typeof entry.payPeriod === "object"
      ? JSON.stringify(entry.payPeriod)
      : null,
    entry.description,
    entry.summaryNotes,
    entry.notes,
    entry.reference,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {object} records
 * @returns {{ updated: number, scanned: number }}
 */
function backfillOvernightDays(records) {
  if (!records || typeof records !== "object") return { updated: 0, scanned: 0 };
  const income = Array.isArray(records.income) ? records.income : [];
  const receipts = Array.isArray(records.receipts) ? records.receipts : [];
  const byId = new Map(receipts.map((r) => [r.id, r]));

  let updated = 0;
  let scanned = 0;

  for (const entry of income) {
    if (!needsOvernightBackfill(entry)) continue;
    scanned += 1;

    const receipt =
      (entry.receiptId && byId.get(entry.receiptId)) ||
      receipts.find((r) => r && r.linkedIncomeId === entry.id) ||
      null;

    const blob = textBlobForEntry(entry, receipt);
    if (!blob.trim()) continue;

    const ta = extractTravelAllowance(
      {
        rawText: blob,
        date: entry.date,
        componentBreakdown:
          receipt && receipt.ocrResult && receipt.ocrResult.componentBreakdown,
      },
      { date: entry.date }
    );

    if (!(Number(ta.overnightDays) > 0) && !(Number(ta.amount) > 31)) continue;

    // Clear a mistaken hours-as-$ amount before applying the corrected extract.
    if (looksLikeHoursMistakenForDollars(entry) && Number(ta.amount) > 31) {
      entry.travelAllowanceAmount = undefined;
    }

    applyTravelAllowanceToEntry(entry, {
      amount: Number(ta.amount) > 31 ? ta.amount : undefined,
      overnightDays: ta.overnightDays,
      daysSource: `backfill_${ta.daysSource || "ocr"}`,
    });
    updated += 1;
  }

  return { updated, scanned };
}

module.exports = {
  backfillOvernightDays,
  needsOvernightBackfill,
  looksLikeHoursMistakenForDollars,
};
