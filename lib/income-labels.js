/**
 * First-party helpers to keep income uploads labelled with payslip / pay-period
 * terminology and free of "cheque" wording (which can be picked up from a
 * document's payment-method text). The provided OCR modules are left untouched;
 * server.js applies these to the income OCR result and to saved income entries.
 */

// Text fields on an income OCR result / entry that a user actually sees.
const TEXT_FIELDS = ["entity", "payer", "vendor", "description", "summaryNotes", "payPeriod", "reference", "notes"];

/** Remove only the "cheque"/"chq" wording (preserves surrounding layout). */
function stripChequeTokens(value) {
  if (value == null) return value;
  const s = String(value);
  if (!/cheque|chq/i.test(s)) return s;
  return s
    .replace(/\b(?:payment|paid|pay)\s+by\s+cheques?\b/gi, "")
    .replace(/\b(?:cheques?|chqs?)\s*(?:no\.?|number|#)?[:#]?\s*\d[\d-]*\b/gi, "")
    .replace(/\b(?:payment\s*method|method|tender|pay(?:ment)?\s*type)\s*[:-]?\s*cheques?\b/gi, "")
    .replace(/\bchqs?\b/gi, "")
    .replace(/\bcheques?\b/gi, "");
}

/** Remove "cheque"/"chq" wording and tidy separators/brackets (short fields). */
function stripCheque(value) {
  if (value == null) return value;
  const stripped = stripChequeTokens(value);
  if (stripped === value) return value;
  return String(stripped)
    .replace(/\(\s*\)|\[\s*\]/g, "") // empty brackets left behind
    .replace(/\s{2,}/g, " ")
    .replace(/\s*([·|,;:])\s*(?=[·|,;:]|$)/g, "")
    .replace(/^[\s·|,;:.()-]+|[\s·|,;:.()-]+$/g, "")
    .trim();
}

/** Strip cheque wording from every user-facing text field of an income object. */
function sanitizeIncomeFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  for (const key of TEXT_FIELDS) {
    if (typeof obj[key] === "string") obj[key] = stripCheque(obj[key]);
  }
  return obj;
}

/**
 * Canonical income description: "Payslip"/"Remittance" + the pay period (with
 * dates) — never a payment method like cheque.
 */
function buildIncomeDescription(obj) {
  const o = obj || {};
  const kind = o.documentKind === "remittance" ? "Remittance" : "Payslip";
  const pp = o.payPeriodInfo || {};
  const periodText = pp.from && pp.text ? pp.text : stripCheque(o.payPeriod || "");
  const parts = [];
  if (periodText) parts.push(`pay period ${periodText}`);
  else if (o.date) parts.push(`pay period ending ${o.date}`);
  if (pp.paymentDateLabel) parts.push(`paid ${pp.paymentDateLabel}`);
  const suffix = parts.join(" · ");
  return suffix ? `${kind} — ${suffix}` : kind;
}

module.exports = { stripCheque, stripChequeTokens, sanitizeIncomeFields, buildIncomeDescription };
