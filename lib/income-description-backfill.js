/**
 * Retroactively rewrite clutter income descriptions (e.g. "Payslip",
 * "Facsimile") to "Company, pay period DD/MM/YYYY to DD/MM/YYYY" using
 * linked receipt OCR text and stored pay-period fields.
 */
const {
  buildIncomeDescription,
  looksLikeClutterName,
  sanitizeIncomeFields,
} = require("./income-labels");
const { computePayPeriod } = require("./document-breakdown");

function isDeleted(entry) {
  return Boolean(entry && (entry.deletedAt || entry.deleted));
}

function needsDescriptionBackfill(entry) {
  if (!entry || isDeleted(entry)) return false;
  const d = String(entry.description || "").trim();
  if (!d) return true;
  if (looksLikeClutterName(d)) return true;
  if (/^(payslip|remittance)\b/i.test(d)) return true;
  // Old "Payslip — pay period …" style without a company name.
  if (/^(payslip|remittance)\s*[—–-]/i.test(d) && !/, pay period /i.test(d)) return true;
  return false;
}

/**
 * @param {object} records
 * @returns {{ updated: number, scanned: number }}
 */
function backfillIncomeDescriptions(records) {
  if (!records || typeof records !== "object") return { updated: 0, scanned: 0 };
  const income = Array.isArray(records.income) ? records.income : [];
  const receipts = Array.isArray(records.receipts) ? records.receipts : [];
  const byId = new Map(receipts.map((r) => [r.id, r]));

  let updated = 0;
  let scanned = 0;

  for (const entry of income) {
    if (!needsDescriptionBackfill(entry)) continue;
    scanned += 1;

    const receipt =
      (entry.receiptId && byId.get(entry.receiptId)) ||
      receipts.find((r) => r && r.linkedIncomeId === entry.id) ||
      null;
    const ocr = (receipt && receipt.ocrResult) || {};
    const rawText = ocr.rawText || ocr.rawTextPreview || "";

    const payPeriodInfo =
      ocr.payPeriodInfo ||
      (rawText ? computePayPeriod(rawText) : null) ||
      null;

    const draft = {
      entity: entry.entity || entry.payer || ocr.entity || ocr.vendor || ocr.payer,
      payer: entry.payer || entry.entity || ocr.payer,
      vendor: entry.vendor || ocr.vendor,
      documentKind: entry.documentKind || ocr.documentKind || "payslip",
      date: entry.date || ocr.date,
      payPeriod: entry.payPeriod || ocr.payPeriod || "",
      payPeriodInfo,
      rawText: rawText || entry.description || "",
      description: entry.description,
      summaryNotes: entry.summaryNotes,
    };

    sanitizeIncomeFields(draft);
    const next = buildIncomeDescription(draft);
    if (!next || next === entry.description) continue;
    // Only apply when we improved beyond bare Payslip/Remittance, or fixed clutter.
    if (/^(Payslip|Remittance)$/i.test(next) && entry.description) continue;

    entry.description = next;
    if (
      !entry.summaryNotes ||
      /^entity\s*:/i.test(String(entry.summaryNotes)) ||
      /gross\s*:/i.test(String(entry.summaryNotes)) ||
      looksLikeClutterName(entry.summaryNotes)
    ) {
      entry.summaryNotes = next;
    }
    if (draft.entity && (!entry.entity || looksLikeClutterName(entry.entity))) {
      entry.entity = draft.entity;
      entry.payer = entry.payer || draft.entity;
    }
    if (payPeriodInfo && payPeriodInfo.text && !entry.payPeriod) {
      entry.payPeriod = payPeriodInfo.text;
    }
    updated += 1;
  }

  return { updated, scanned };
}

module.exports = {
  backfillIncomeDescriptions,
  needsDescriptionBackfill,
};
