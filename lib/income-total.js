/**
 * Income scan primary picker for remittances / payslips / invoices.
 *
 * Prefer amounts labeled net income / net pay (etc.). If no net-labeled
 * total is present, fall back to the largest plausible pay figure (not GST,
 * PAYG, YTD, super, or other non-pay lines).
 *
 * Layers on top of mergeDetectedTotals without editing verbatim OCR modules.
 */

const { parseMoney } = require("./receipt-ocr-money");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Strong net-pay / net-income wording (highest priority). */
const NET_LABEL_RE =
  /\b(?:net\s*(?:pay|income|earnings|amount|wages|remittance|total)|take[\s-]*home(?:\s*pay)?)\b/i;

/** Any label that still clearly means a net figure (broader). */
const NET_LOOSE_RE = /\bnet\b/i;

/** Never choose these as the uploaded primary total. */
const EXCLUDE_PRIMARY_RE =
  /\b(?:gst|payg(?:\s*withholding)?|tax\s*withheld|withholding\s*tax|ytd|year[\s-]*to[\s-]*date|super(?:annuation)?|deduction|deducted|salary\s*sacrifice|reimbursement)\b/i;

/** Gross / taxable — kept in the list but never preferred over net. */
const GROSS_LABEL_RE =
  /\b(?:gross|taxable(?:\s*income)?|ordinary\s*time|wages\s*\/\s*gross|remittance\s*total|payment\s*total)\b/i;

const MONEY =
  "((?:\\d{1,3}(?:,\\d{3})+|\\d{1,7})(?:\\.\\d{1,2})?)";

const NET_TEXT_PATTERNS = [
  "net\\s*income",
  "net\\s*pay",
  "net\\s*earnings",
  "net\\s*amount",
  "net\\s*wages",
  "net\\s*remittance",
  "net\\s*total",
  "take\\s*home(?:\\s*pay)?",
];

function isNetLabel(label) {
  const s = String(label || "");
  if (!s.trim()) return false;
  if (EXCLUDE_PRIMARY_RE.test(s) && !NET_LABEL_RE.test(s)) return false;
  return NET_LABEL_RE.test(s) || (NET_LOOSE_RE.test(s) && !GROSS_LABEL_RE.test(s));
}

function isExcludedFromPrimary(label) {
  const s = String(label || "");
  if (!s.trim()) return false;
  if (isNetLabel(s)) return false;
  return EXCLUDE_PRIMARY_RE.test(s);
}

function isPlausiblePayAmount(amount) {
  const n = round2(amount);
  // Accept any positive pay figure — including $1,900–$2,100 nets that look
  // like calendar years when unlabeled OCR candidates are filtered elsewhere.
  return n > 0;
}

/**
 * Pull a labeled net amount from raw OCR text when structured fields missed it.
 */
function extractLabeledNetFromText(text) {
  const src = String(text || "");
  if (!src.trim()) return null;
  for (const pattern of NET_TEXT_PATTERNS) {
    const re = new RegExp(`${pattern}[^\\d$]{0,60}\\$?\\s*${MONEY}`, "i");
    const m = src.match(re);
    if (!m) continue;
    const amount = parseMoney(m[1]);
    if (!(amount > 0)) continue;
    // Skip bare years only when the capture has no cents (OCR date bleed).
    if (Number.isInteger(amount) && amount >= 1900 && amount <= 2100) continue;
    let label = "Net pay";
    if (pattern.includes("take")) label = "Take home pay";
    else if (pattern.includes("income")) label = "Net income";
    else if (pattern.includes("earnings")) label = "Net earnings";
    else if (pattern.includes("remittance")) label = "Net remittance";
    return { label, amount: round2(amount), source: "rawText" };
  }
  return null;
}

function cloneTotals(detectedTotals) {
  return Array.isArray(detectedTotals) ? detectedTotals.map((t) => ({ ...t })) : [];
}

function ensureRow(out, label, amount) {
  const value = round2(amount);
  if (!isPlausiblePayAmount(value)) return null;
  let row = out.find((t) => Math.abs(Number(t.amount) - value) < 0.005);
  if (!row) {
    row = { label, amount: value, primary: false };
    out.unshift(row);
  } else if (isNetLabel(label) && !isNetLabel(row.label)) {
    row.label = label;
  }
  return row;
}

/**
 * Choose the primary income total for the approve UI / amount field.
 * @returns {{ amount: number, label: string, reason: string } | null}
 */
function pickBestIncomePrimary(detectedTotals, ocrResult = {}) {
  const out = cloneTotals(detectedTotals);
  const o = ocrResult || {};

  const fromText = extractLabeledNetFromText(o.rawText || o.rawTextPreview || "");
  if (fromText) ensureRow(out, fromText.label, fromText.amount);

  if (isPlausiblePayAmount(o.netPay)) {
    ensureRow(out, "Net pay", o.netPay);
  }

  const netRows = out.filter((t) => isNetLabel(t.label) && isPlausiblePayAmount(t.amount));
  if (netRows.length) {
    // Prefer explicit "net income" / "net pay" wording, then larger amount.
    const ranked = [...netRows].sort((a, b) => {
      const aStrong = NET_LABEL_RE.test(a.label) ? 1 : 0;
      const bStrong = NET_LABEL_RE.test(b.label) ? 1 : 0;
      if (bStrong !== aStrong) return bStrong - aStrong;
      return b.amount - a.amount;
    });
    const best = ranked[0];
    return { amount: round2(best.amount), label: best.label, reason: "net_label" };
  }

  // No net wording — largest remaining pay figure.
  const candidates = out.filter(
    (t) => isPlausiblePayAmount(t.amount) && !isExcludedFromPrimary(t.label)
  );
  if (!candidates.length) {
    const any = out.filter((t) => isPlausiblePayAmount(t.amount));
    if (!any.length) return null;
    const biggest = any.reduce((a, b) => (a.amount >= b.amount ? a : b));
    return { amount: round2(biggest.amount), label: biggest.label || "Amount", reason: "largest" };
  }
  const biggest = candidates.reduce((a, b) => (a.amount >= b.amount ? a : b));
  return {
    amount: round2(biggest.amount),
    label: biggest.label || "Amount",
    reason: "largest",
  };
}

/**
 * After mergeDetectedTotals, force income primary to net pay / net income when
 * present; otherwise the largest non-excluded amount.
 */
function refineIncomeDetectedTotals(detectedTotals, ocrResult = {}, _components = []) {
  const out = cloneTotals(detectedTotals);
  const best = pickBestIncomePrimary(out, ocrResult);
  if (!best) return out;

  const row = ensureRow(out, best.label, best.amount);
  if (!row) return out;

  if (best.reason === "net_label" && !isNetLabel(row.label)) {
    row.label = best.label;
  }

  for (const t of out) t.primary = false;
  row.primary = true;
  out.sort((a, b) => Number(b.primary) - Number(a.primary) || b.amount - a.amount);
  return out;
}

/**
 * Sync OCR amount fields after primary selection so confirm UI / save use net.
 */
function applyIncomePrimaryToOcr(ocrResult, primaryTotal) {
  const o = ocrResult && typeof ocrResult === "object" ? ocrResult : null;
  if (!o || !primaryTotal || !(Number(primaryTotal.amount) > 0)) return o;
  const amount = round2(primaryTotal.amount);
  const netPrimary = isNetLabel(primaryTotal.label);

  o.amount = amount;
  if (netPrimary || !(Number(o.netPay) > 0)) {
    o.netPay = amount;
  }
  // Never overwrite an existing gross with the net primary.
  return o;
}

module.exports = {
  isNetLabel,
  isExcludedFromPrimary,
  extractLabeledNetFromText,
  pickBestIncomePrimary,
  refineIncomeDetectedTotals,
  applyIncomePrimaryToOcr,
  NET_LABEL_RE,
};
