/**
 * Detect a second ledger entry for a document that is already saved.
 *
 * A match is the same purpose and the same cents, plus the same day.
 * The shop name can differ — OCR often reads it wrong, and the warning
 * still has to appear. When the new entry has no date, the shop name and
 * the amount have to match instead. Soft-deleted rows are ignored.
 * The driver can still continue.
 */
const { toIsoAusDate } = require("./aus-date");

const LABEL_RE = /(\d{2})\.(\d{2})\.(\d{2})\s+AUD\$(\d+(?:\.\d{2})?)/i;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeDate(dateInput) {
  if (dateInput == null || dateInput === "") return null;
  return toIsoAusDate(dateInput);
}

function normalizeVendor(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(pty|ltd|limited|australia|aust|the|co|company|inc|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function vendorsMatch(a, b) {
  const na = normalizeVendor(a);
  const nb = normalizeVendor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function amountsMatch(a, b) {
  const aa = round2(a);
  const bb = round2(b);
  if (!(aa > 0) || !(bb > 0)) return false;
  return aa === bb;
}

function collectAmounts(values) {
  const out = [];
  for (const value of values) {
    const n = round2(value);
    if (!(n > 0) || out.includes(n)) continue;
    out.push(n);
  }
  return out;
}

function collectDates(values) {
  const out = [];
  for (const value of values) {
    const d = normalizeDate(value);
    if (!d || out.includes(d)) continue;
    out.push(d);
  }
  return out;
}

/** "DD.MM.YY AUD$123.45.ext" — the name written when a document is approved. */
function parseLabeledFilename(filename) {
  const m = String(filename || "").match(LABEL_RE);
  if (!m) return null;
  const date = normalizeDate(`${m[1]}/${m[2]}/${m[3]}`);
  const amount = round2(m[4]);
  if (!date || !(amount > 0)) return null;
  return { date, amount };
}

function candidateFromOcr(ocrResult, purpose, primaryAmount) {
  const o = ocrResult || {};
  const date = normalizeDate(o.date);
  const vendor =
    purpose === "income" ? o.entity || o.vendor || o.payer || "" : o.vendor || o.entity || "";
  const amounts =
    purpose === "income"
      ? collectAmounts([primaryAmount, o.grossTotal, o.amount, o.netPay, o.taxableIncome])
      : collectAmounts([primaryAmount, o.amount]);
  if (!amounts.length) return null;
  if (!date && !normalizeVendor(vendor)) return null;
  return { date, vendor: String(vendor || "").trim(), amount: amounts[0], amounts };
}

function amountsOverlap(candidateAmounts, rowAmounts) {
  return candidateAmounts.some((a) => rowAmounts.some((b) => amountsMatch(a, b)));
}

function rowMatchesCandidate(cand, rowDates, rowAmounts, rowVendor) {
  if (!cand || !rowAmounts.length) return false;
  if (!amountsOverlap(cand.amounts, rowAmounts)) return false;
  if (cand.date) return rowDates.includes(cand.date);
  return vendorsMatch(cand.vendor, rowVendor);
}

function pushMatch(out, seen, entry) {
  const key = `${entry.source}:${entry.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(entry);
}

function receiptPurpose(receipt) {
  if (!receipt) return null;
  if (receipt.purpose === "income" || receipt.purpose === "expense") return receipt.purpose;
  if (receipt.linkedIncomeId) return "income";
  if (receipt.linkedExpenseId) return "expense";
  const doc = receipt.ocrResult?.documentType || receipt.manual?.documentKind;
  if (doc === "income" || doc === "payslip" || doc === "remittance") return "income";
  return "expense";
}

function isSoftDeleted(entry) {
  return Boolean(entry && entry.deletedAt);
}

/**
 * Find existing ledger / receipt rows that match this entry.
 * Scoped by purpose so an expense does not block a payslip (and vice versa).
 * options.excludeReceiptId skips the document currently being approved.
 */
function findDuplicateMatches(records, ocrResult, purpose, primaryAmount, options) {
  const cand = candidateFromOcr(ocrResult, purpose, primaryAmount);
  if (!cand) return [];

  const excludeReceiptId = options && options.excludeReceiptId ? String(options.excludeReceiptId) : "";
  const out = [];
  const seen = new Set();
  const isIncome = purpose === "income";

  if (isIncome) {
    for (const i of records.income || []) {
      if (!i || isSoftDeleted(i)) continue;
      if (excludeReceiptId && i.receiptId && String(i.receiptId) === excludeReceiptId) continue;
      const vendor = i.entity || i.payer || "";
      const rowAmounts = collectAmounts([i.grossTotal, i.amount, i.netPay, i.taxableIncome]);
      if (!rowMatchesCandidate(cand, collectDates([i.date]), rowAmounts, vendor)) continue;
      pushMatch(out, seen, {
        source: "income",
        id: i.id,
        date: i.date,
        vendor,
        amount: round2(i.grossTotal != null ? i.grossTotal : i.amount),
      });
    }
  } else {
    for (const e of records.expenses || []) {
      if (!e || isSoftDeleted(e)) continue;
      if (excludeReceiptId && e.receiptId && String(e.receiptId) === excludeReceiptId) continue;
      const vendor = e.vendor || "";
      if (!rowMatchesCandidate(cand, collectDates([e.date]), collectAmounts([e.amount]), vendor)) continue;
      pushMatch(out, seen, {
        source: "expense",
        id: e.id,
        date: e.date,
        vendor,
        amount: round2(e.amount),
      });
    }
  }

  for (const r of records.receipts || []) {
    if (!r || isSoftDeleted(r)) continue;
    if (excludeReceiptId && String(r.id) === excludeReceiptId) continue;
    if (receiptPurpose(r) !== (isIncome ? "income" : "expense")) continue;
    if (r.linkedExpenseId && seen.has(`expense:${r.linkedExpenseId}`)) continue;
    if (r.linkedIncomeId && seen.has(`income:${r.linkedIncomeId}`)) continue;
    const manual = r.manual || {};
    const ocr = r.ocrResult || {};
    const label = parseLabeledFilename(r.filename);
    const vendor = isIncome
      ? manual.entity || manual.vendor || manual.payer || ocr.entity || ocr.vendor || ocr.payer || ""
      : manual.vendor || manual.entity || ocr.vendor || ocr.entity || "";
    const rowAmounts = collectAmounts([
      isIncome ? manual.grossTotal : null,
      manual.amount,
      manual.netPay,
      manual.taxableIncome,
      isIncome ? ocr.grossTotal : null,
      ocr.amount,
      isIncome ? ocr.netPay : null,
      isIncome ? ocr.taxableIncome : null,
      label && label.amount,
    ]);
    const rowDates = collectDates([manual.date, ocr.date, label && label.date]);
    if (!rowMatchesCandidate(cand, rowDates, rowAmounts, vendor)) continue;
    const date = rowDates.find((d) => d === cand.date) || rowDates[0] || null;
    const amount = rowAmounts.find((n) => cand.amounts.some((a) => amountsMatch(a, n))) || rowAmounts[0];
    pushMatch(out, seen, {
      source: "receipt",
      id: r.id,
      date,
      vendor,
      amount: round2(amount),
      filename: r.filename || null,
    });
  }

  return out;
}

module.exports = {
  normalizeDate,
  normalizeVendor,
  vendorsMatch,
  amountsMatch,
  candidateFromOcr,
  findDuplicateMatches,
  receiptPurpose,
  parseLabeledFilename,
};
