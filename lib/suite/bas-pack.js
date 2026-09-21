/**
 * BAS / GST quarterly pack for sole traders and GST-registered entities.
 * GST on GST-inclusive amounts is 1/11.
 */
const { getFinancialYearForDate } = require("./ato");
const { normalizeEntityType } = require("./profile");

const GST_FRACTION = 1 / 11;

const QUARTERS = [
  { id: "q1", label: "Quarter 1 (1 Jul – 30 Sep)", months: [7, 8, 9] },
  { id: "q2", label: "Quarter 2 (1 Oct – 31 Dec)", months: [10, 11, 12] },
  { id: "q3", label: "Quarter 3 (1 Jan – 31 Mar)", months: [1, 2, 3] },
  { id: "q4", label: "Quarter 4 (1 Apr – 30 Jun)", months: [4, 5, 6] },
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function gstInclusive(amount) {
  return round2((Number(amount) || 0) * GST_FRACTION);
}

function explicitGst(entry) {
  const n = Number(entry && (entry.gstAmount || entry.gst));
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

function gstOf(entry, amount) {
  const named = explicitGst(entry);
  return named != null ? named : gstInclusive(amount);
}

function monthOf(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getMonth() + 1;
}

function findQuarter(id) {
  const key = String(id || "").toLowerCase();
  return QUARTERS.find((q) => q.id === key) || null;
}

function inQuarter(date, quarter) {
  if (!quarter) return true;
  const m = monthOf(date);
  return quarter.months.includes(m);
}

function eligibleForBas(profile = {}) {
  const entity = normalizeEntityType(profile.entityType || profile.driverType);
  if (profile.gstRegistered) return true;
  return entity === "sole_trader" || entity === "partnership";
}

function buildBasPack(records, profile = {}, opts = {}) {
  const fy = String(opts.financialYear || profile.financialYear || "").trim();
  const quarter = findQuarter(opts.quarter);
  const expenses = (records.expenses || []).filter((e) => {
    if (fy && getFinancialYearForDate(e.date) !== fy) return false;
    return inQuarter(e.date, quarter);
  });
  const income = (records.income || []).filter((e) => {
    if (fy && getFinancialYearForDate(e.date) !== fy) return false;
    return inQuarter(e.date, quarter);
  });

  let sales = 0;
  let gstOnSales = 0;
  for (const inc of income) {
    const amount = Number(inc.amount) || 0;
    sales = round2(sales + amount);
    gstOnSales = round2(gstOnSales + gstOf(inc, amount));
  }

  let purchases = 0;
  let gstOnPurchases = 0;
  for (const exp of expenses) {
    const amount = Number(exp.amount) || 0;
    purchases = round2(purchases + amount);
    gstOnPurchases = round2(gstOnPurchases + gstOf(exp, amount));
  }

  return {
    financialYear: fy || null,
    quarter: quarter ? quarter.id : "all",
    quarterLabel: quarter ? quarter.label : "Full financial year",
    gstRegistered: Boolean(profile.gstRegistered),
    entityType: normalizeEntityType(profile.entityType || profile.driverType),
    eligible: eligibleForBas(profile),
    gstFraction: "1/11",
    sales,
    purchases,
    gstOnSales,
    gstOnPurchases,
    netGst: round2(gstOnSales - gstOnPurchases),
    incomeCount: income.length,
    expenseCount: expenses.length,
    quarters: QUARTERS.map((q) => ({ id: q.id, label: q.label })),
    note:
      "Amounts treat recorded totals as GST-inclusive unless a GST figure was stored on the row. Confirm figures on the ATO activity statement — this pack is a working summary, not a lodged BAS.",
  };
}

module.exports = {
  GST_FRACTION,
  QUARTERS,
  gstInclusive,
  eligibleForBas,
  buildBasPack,
};
