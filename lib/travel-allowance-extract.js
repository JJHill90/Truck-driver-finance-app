/**
 * Extract Travel / Overnight / LAFHA allowance amounts from payslip /
 * remittance OCR text so we can estimate overnight days claimed.
 *
 * Does not edit verbatim OCR modules — runs after scan enrichment.
 *
 * Payslips often use a tabular line:
 *   Travel Allowance  HOURS  RATE  AMOUNT  YTD
 *   Travel Allowance  7.00   56.28 393.96  16715.16
 * Prefer HOURS/DAYS as the overnight counter; prefer AMOUNT (not hours/YTD) as $.
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

function parseCountToken(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 31) return null;
  // Prefer whole nights/hours; allow .00 from payroll systems.
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) > 0.051) return null;
  return rounded;
}

const LABEL_RE =
  /\b(travel\s*allowance|overnight\s*allowance|living\s*away(?:\s*from\s*home)?(?:\s*allowance)?|lafha|driver\s*daily\s*allowance|away\s*from\s*home\s*allowance|total\s*allowance)\b/i;

/** Tabular: Label  hours/days  rate  amount  [ytd] */
const TABULAR_LINE_RE =
  /\b(travel\s*allowance|overnight\s*allowance|living\s*away(?:\s*from\s*home)?(?:\s*allowance)?|lafha|driver\s*daily\s*allowance|away\s*from\s*home\s*allowance|total\s*allowance)\s+(\d{1,3}(?:\.\d{1,2})?)\s+\$?\s*([\d,]+\.\d{2})\s+\$?\s*([\d,]+\.\d{2})(?:\s+\$?\s*([\d,]+\.\d{2}))?/gi;

const AMOUNT_NEAR_LABEL_RE =
  /\b(travel\s*allowance|overnight\s*allowance|living\s*away(?:\s*from\s*home)?(?:\s*allowance)?|lafha|driver\s*daily\s*allowance|away\s*from\s*home\s*allowance|total\s*allowance)\b[^0-9$]{0,40}\$\s*([\d,]+\.\d{2}|\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/gi;

const AMOUNT_BEFORE_LABEL_RE =
  /\$\s*([\d,]+\.\d{2}|\d{1,5}(?:,\d{3})*(?:\.\d{2})?)[^A-Za-z0-9]{0,24}\b(travel\s*allowance|overnight\s*allowance|living\s*away(?:\s*from\s*home)?(?:\s*allowance)?|lafha|driver\s*daily\s*allowance|total\s*allowance)\b/gi;

const DAYS_NEAR_LABEL_RE =
  /\b(travel\s*allowance|overnight\s*allowance|lafha|living\s*away|total\s*allowance)[\s\S]{0,72}?(\d{1,3})\s*(?:nights?|days?|overnights?)\b/gi;

const DAYS_BEFORE_LABEL_RE =
  /\b(\d{1,3})\s*(?:nights?|days?|overnights?)[^A-Za-z0-9]{0,32}\b(travel\s*allowance|overnight\s*allowance|lafha|total\s*allowance)\b/gi;

const HOURS_NEAR_LABEL_RE =
  /\b(travel\s*allowance|overnight\s*allowance|lafha|living\s*away|total\s*allowance)[\s\S]{0,72}?(\d{1,3}(?:\.\d{1,2})?)\s*(?:hours?|hrs?)\b/gi;

const HOURS_BEFORE_LABEL_RE =
  /\b(\d{1,3}(?:\.\d{1,2})?)\s*(?:hours?|hrs?)[^A-Za-z0-9]{0,32}\b(travel\s*allowance|overnight\s*allowance|lafha|total\s*allowance)\b/gi;

function collectTabularHits(text) {
  const found = [];
  const src = String(text || "");
  TABULAR_LINE_RE.lastIndex = 0;
  let m;
  while ((m = TABULAR_LINE_RE.exec(src))) {
    const hours = parseCountToken(m[2]);
    const rate = parseMoneyToken(m[3]);
    const amount = parseMoneyToken(m[4]);
    const ytd = m[5] != null ? parseMoneyToken(m[5]) : null;
    // Guard: amount should exceed rate (line total), and beat a tiny "hours-as-$" misread.
    if (amount == null) continue;
    if (rate != null && amount < rate * 0.5) continue;
    if (ytd != null && amount >= ytd) continue;
    found.push({
      hours,
      rate,
      amount,
      ytd,
      label: m[1],
    });
  }
  return found;
}

function collectAmounts(text) {
  const found = [];
  const src = String(text || "");
  for (const re of [AMOUNT_NEAR_LABEL_RE, AMOUNT_BEFORE_LABEL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const amount = parseMoneyToken(m[2] || m[1]);
      // Skip tiny values that are almost certainly hours, not dollars.
      if (amount != null && amount > 31) found.push(amount);
      else if (amount != null && amount > 0 && src.includes("$")) {
        // Explicit $ even if small (rare).
        const full = m[0] || "";
        if (/\$/.test(full)) found.push(amount);
      }
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
      const days = parseCountToken(m[2] || m[1]);
      if (days != null) found.push(days);
    }
  }
  return found;
}

function collectExplicitHours(text) {
  const found = [];
  const src = String(text || "");
  for (const re of [HOURS_NEAR_LABEL_RE, HOURS_BEFORE_LABEL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const hours = parseCountToken(m[2] || m[1]);
      if (hours != null) found.push(hours);
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
  const tabular = collectTabularHits(text);
  const amounts = collectAmounts(text);
  const explicitDays = collectExplicitDays(text);
  const explicitHours = collectExplicitHours(text);

  let amount = null;
  let overnightDays = null;
  let daysSource = null;

  if (tabular.length) {
    // Prefer the largest plausible line amount (not YTD).
    const best = tabular.reduce((a, b) => (b.amount > (a.amount || 0) ? b : a));
    amount = best.amount;
    if (best.hours != null) {
      overnightDays = best.hours;
      daysSource = "payslip_hours";
    }
  }

  if (amount == null && amounts.length) {
    // Prefer mid-range allowance totals over huge YTD figures.
    const mid = amounts.filter((a) => a >= 40 && a <= 5000);
    amount = mid.length ? Math.max(...mid) : Math.max(...amounts);
    // Cap absurd YTD-sized hits when a smaller candidate exists.
    if (amount > 5000 && mid.length) amount = Math.max(...mid);
  }

  // Prefer a breakdown line that looks like travel if present and larger signal.
  if (Array.isArray(ocrResult.componentBreakdown)) {
    for (const c of ocrResult.componentBreakdown) {
      const label = `${c.label || ""} ${c.type || ""} ${c.note || ""}`;
      if (!LABEL_RE.test(label) && !/overnight_allowance/i.test(String(c.type || ""))) continue;
      if (c.detected === false) continue;
      const n = Number(c.amount);
      if (Number.isFinite(n) && n > 31) {
        amount = amount == null ? round2(n) : Math.max(amount, round2(n));
      }
    }
  }

  if (overnightDays == null && explicitDays.length) {
    overnightDays = Math.max(...explicitDays);
    daysSource = "payslip_days";
  } else if (overnightDays == null && explicitHours.length) {
    overnightDays = Math.max(...explicitHours);
    daysSource = "payslip_hours";
  } else if (overnightDays == null && amount != null && ratePerDay > 0) {
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
    confidence:
      daysSource === "payslip_days" || daysSource === "payslip_hours"
        ? "high"
        : amount != null && hasLabel
          ? "medium"
          : "low",
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
  collectTabularHits,
};
