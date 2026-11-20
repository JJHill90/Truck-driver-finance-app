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

function buildHubGstTracker(records = {}, financialYear) {
  const fy = String(financialYear || "").trim();
  let recorded = 0;
  for (const row of records.income || []) {
    if (!row || row.deletedAt) continue;
    if (!BUSINESS_TYPES.has(row.type)) continue;
    if (fy && getFinancialYearForDate(row.date) !== fy) continue;
    recorded = round2(recorded + (Number(row.grossTotal) || Number(row.amount) || 0));
  }
  return {
    product: "haulage",
    threshold: THRESHOLD,
    recorded,
    remaining: round2(Math.max(0, THRESHOLD - recorded)),
    percent: round2((recorded / THRESHOLD) * 100),
    overThreshold: recorded >= THRESHOLD,
    note: `Recorded business turnover $${recorded.toFixed(2)} of the $${THRESHOLD.toLocaleString("en-AU")} GST registration threshold. Salary, wages and allowances are not included. This is a tracker, not a registration decision.`,
  };
}

module.exports = {
  THRESHOLD,
  BUSINESS_TYPES,
  buildHubGstTracker,
};
