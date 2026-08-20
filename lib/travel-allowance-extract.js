/**
 * Extract Travel / Overnight / LAFHA allowance amounts from payslip /
 * remittance OCR text so we can estimate overnight days claimed.
 *
 * Does not edit verbatim OCR modules — runs after scan enrichment.
 */
const { travelRatesForYear } = require("./historical-rates");
const { getFinancialYearForDate, getCurrentFinancialYear } = require("./ato-standards");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseMoneyToken(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

const LABEL_RE =
  /\b(travel\s*allowance|overnight\s*allowance|living\s*away(?:\s*from\s*home)?(?:\s*allowance)?|lafha|driver\s*daily\s*allowance|away\s*from\s*home\s*allowance)\b/i;

const AMOUNT_NEAR_LABEL_RE =
  /\b(travel\s*allowance|overnight\s*allowance|living\s*away(?:\s*from\s*home)?(?:\s*allowance)?|lafha|driver\s*daily\s*allowance|away\s*from\s*home\s*allowance)\b[^0-9$]{0,40}(?:\$?\s*)([\d,]+\.\d{2}|\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/gi;

const AMOUNT_BEFORE_LABEL_RE =
  /(?:\$?\s*)([\d,]+\.\d{2}|\d{1,5}(?:,\d{3})*(?:\.\d{2})?)[^A-Za-z0-9]{0,24}\b(travel\s*allowance|overnight\s*allowance|living\s*away(?:\s*from\s*home)?(?:\s*allowance)?|lafha|driver\s*daily\s*allowance)\b/gi;

const DAYS_NEAR_LABEL_RE =
  /\b(travel\s*allowance|overnight\s*allowance|lafha|living\s*away)[\s\S]{0,72}?(\d{1,3})\s*(?:nights?|days?|overnights?)\b/gi;

const DAYS_BEFORE_LABEL_RE =
  /\b(\d{1,3})\s*(?:nights?|days?|overnights?)[^A-Za-z0-9]{0,32}\b(travel\s*allowance|overnight\s*allowance|lafha)\b/gi;

function collectAmounts(text) {
  const found = [];
  const src = String(text || "");
  for (const re of [AMOUNT_NEAR_LABEL_RE, AMOUNT_BEFORE_LABEL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const amount = parseMoneyToken(m[2] || m[1]);
      if (amount != null) found.push(amount);
    }
  }
  return found;
}

function collectExplicitDays(text) {
  const found = [];
  const src = String(text || "");
  for (const re of [DAYS_NEAR_LABEL_RE, DAYS_BEFORE_LABEL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const days = Number(m[2] || m[1]);
      if (Number.isFinite(days) && days > 0 && days <= 31) found.push(days);
    }
  }
  return found;
}

function mealRateForDate(dateIso, financialYear) {
  const fy =
    financialYear ||
    (dateIso && getFinancialYearForDate(dateIso)) ||
    getCurrentFinancialYear();
  return travelRatesForYear(fy).truckDriverMealsDailyTotal;
}

/**
 * @param {object} ocrResult
 * @param {{ financialYear?: string, date?: string }} [opts]
 * @returns {{
 *   detected: boolean,
 *   amount: number|null,
 *   overnightDays: number|null,
 *   daysSource: string|null,
 *   ratePerDay: number,
 *   label: string|null,
 *   confidence: string
 * }}
 */
function extractTravelAllowance(ocrResult = {}, opts = {}) {
  const text = [
    ocrResult.rawText,
    ocrResult.rawTextPreview,
    ocrResult.description,
    ocrResult.summaryNotes,
    ocrResult.notes,
    Array.isArray(ocrResult.lineItems)
      ? ocrResult.lineItems.map((l) => `${l.description || l.label || ""} ${l.amount || ""}`).join("\n")
      : "",
    Array.isArray(ocrResult.componentBreakdown)
      ? ocrResult.componentBreakdown
          .filter((c) => c && c.detected !== false)
          .map((c) => `${c.label || c.type || ""} ${c.amount || ""}`)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const dateIso = opts.date || ocrResult.date || null;
  const ratePerDay = mealRateForDate(dateIso, opts.financialYear);
  const hasLabel = LABEL_RE.test(text);
  const amounts = collectAmounts(text);
  const explicitDays = collectExplicitDays(text);

  let amount = amounts.length ? Math.max(...amounts) : null;
  // Prefer a breakdown line that looks like travel if present and larger signal.
  if (Array.isArray(ocrResult.componentBreakdown)) {
    for (const c of ocrResult.componentBreakdown) {
      const label = `${c.label || ""} ${c.type || ""} ${c.note || ""}`;
      if (!LABEL_RE.test(label) && !/overnight_allowance/i.test(String(c.type || ""))) continue;
      // Skip synthetic ATO estimates that were not detected on the slip.
      if (c.detected === false) continue;
      const n = Number(c.amount);
      if (Number.isFinite(n) && n > 0) {
        amount = amount == null ? round2(n) : Math.max(amount, round2(n));
      }
    }
  }

  let overnightDays = null;
  let daysSource = null;
  if (explicitDays.length) {
    overnightDays = Math.max(...explicitDays);
    daysSource = "payslip_days";
  } else if (amount != null && ratePerDay > 0) {
    // Estimate nights from $ ÷ ATO truck-driver meal rate for the FY.
    overnightDays = Math.max(0, Math.round(amount / ratePerDay));
    daysSource = "amount_div_rate";
  }

  // Cap absurd OCR (e.g. whole gross mis-tagged) to a month of nights.
  if (overnightDays != null && overnightDays > 31) {
    overnightDays = null;
    daysSource = null;
  }

  const detected = Boolean(hasLabel && (amount != null || overnightDays != null));

  return {
    detected,
    amount: amount != null ? round2(amount) : null,
    overnightDays,
    daysSource,
    ratePerDay: round2(ratePerDay),
    label: detected ? "Travel / overnight allowance" : null,
    confidence: explicitDays.length ? "high" : amount != null && hasLabel ? "medium" : "low",
  };
}

/**
 * Apply travel-allowance fields onto an income ledger entry (mutates entry).
 */
function applyTravelAllowanceToEntry(entry, source = {}) {
  if (!entry || typeof entry !== "object") return entry;
  const amount =
    source.travelAllowanceAmount != null
      ? Number(source.travelAllowanceAmount)
      : source.amount != null
        ? Number(source.amount)
        : null;
  const days =
    source.overnightDays != null
      ? Number(source.overnightDays)
      : source.days != null
        ? Number(source.days)
        : null;

  if (Number.isFinite(amount) && amount > 0) {
    entry.travelAllowanceAmount = round2(amount);
  }
  if (Number.isFinite(days) && days > 0) {
    entry.overnightDays = Math.round(days);
  }
  if (source.daysSource) entry.overnightDaysSource = String(source.daysSource);
  else if (entry.overnightDays != null && entry.travelAllowanceAmount != null) {
    entry.overnightDaysSource = entry.overnightDaysSource || "confirm";
  }
  return entry;
}

module.exports = {
  extractTravelAllowance,
  applyTravelAllowanceToEntry,
  mealRateForDate,
  LABEL_RE,
};
