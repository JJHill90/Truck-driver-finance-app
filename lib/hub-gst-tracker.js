/**
 * Hub GST registration tracker. Separate from the Suite EOFY indicator.
 * Counts owner-driver and business income only — not salary, wages or allowances.
 */
const { getFinancialYearForDate } = require("./ato-standards");

const THRESHOLD = 75000;
const BUSINESS_TYPES = new Set(["remittance_owner", "business_income", "services_income"]);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function aud(n) {
  return `$${Number(n || 0).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** GST-inclusive business sale minus the GST on that sale. */
function businessExGst(row) {
  const gross = Number(row.grossTotal) || Number(row.amount) || 0;
  if (row.gstFree) return round2(gross);
  const named = Number(row.gstAmount) || Number(row.gst) || 0;
  const gst = named > 0 ? named : round2(gross / 11);
  return round2(Math.max(0, gross - gst));
}

function buildHubGstTracker(records = {}, financialYear) {
  const fy = String(financialYear || "").trim();
  let recorded = 0;
  for (const row of records.income || []) {
    if (!row || row.deletedAt) continue;
    if (!BUSINESS_TYPES.has(row.type)) continue;
    if (fy && getFinancialYearForDate(row.date) !== fy) continue;
    recorded = round2(recorded + businessExGst(row));
  }
  const remaining = round2(Math.max(0, THRESHOLD - recorded));
  return {
    product: "haulage",
    threshold: THRESHOLD,
    recorded,
    remaining,
    percent: round2((recorded / THRESHOLD) * 100),
    overThreshold: recorded >= THRESHOLD,
    note: `Recorded business turnover ${aud(recorded)} of the ${aud(THRESHOLD)} GST registration threshold (ex-GST). Salary, wages and allowances are not included. This is a tracker, not a registration decision.`,
  };
}

module.exports = {
  THRESHOLD,
  BUSINESS_TYPES,
  buildHubGstTracker,
};
