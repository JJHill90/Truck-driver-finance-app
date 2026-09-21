/**
 * Multi-year comparison / tax pack for an accountant.
 */
const {
  buildFinancialYearWindow,
  financialYearStartYear,
  formatFinancialYearValue,
} = require("./fy-window");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pickNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return round2(n);
  }
  return 0;
}

function snapshotFromSummary(summary) {
  const income = (summary && summary.income) || {};
  const expenses = (summary && summary.expenses) || {};
  const tax = (summary && summary.taxEstimate) || {};
  return {
    financialYear: summary && summary.financialYear,
    assessableIncome: pickNumber(income.assessableTotal, income.total, income.grossTotal),
    deductibleExpenses: pickNumber(expenses.deductibleTotal, expenses.total, expenses.grossTotal),
    taxableIncome: pickNumber(tax.taxableIncome),
    estimatedTax: pickNumber(tax.estimatedTax, tax.incomeTaxAfterOffsets, tax.incomeTax),
    paygWithheld: pickNumber(income.paygWithheld, tax.paygWithheld),
  };
}

function yearsToCompare(count = 3, now = new Date(), selectedFy) {
  const n = Math.min(6, Math.max(2, Number(count) || 3));
  const selectedStart = selectedFy ? Number(String(selectedFy).split("-")[0]) : NaN;
  const currentStart = Number.isFinite(selectedStart)
    ? selectedStart
    : financialYearStartYear(now);
  const years = [];
  for (let i = 0; i < n; i += 1) {
    years.push(formatFinancialYearValue(currentStart - i));
  }
  return years;
}

function buildYearCompare(records, profile, opts = {}) {
  const summariseYear = opts.summariseYear;
  if (typeof summariseYear !== "function") {
    throw new Error("summariseYear is required");
  }
  const years = yearsToCompare(
    opts.years,
    opts.now,
    opts.financialYear || (profile && profile.financialYear)
  );
  const rows = years.map((fy) => {
    const summary = summariseYear(records, { ...(profile || {}), financialYear: fy });
    return snapshotFromSummary(summary);
  });
  const latest = rows[0] || snapshotFromSummary({});
  const previous = rows[1] || null;
  return {
    years,
    rows,
    latest,
    previous,
    window: buildFinancialYearWindow({ now: opts.now, yearsBack: 5, yearsForward: 0 }),
    note: "Compare assessable income, deductions and estimated tax across recent Australian financial years. Verify against lodged returns.",
  };
}

module.exports = {
  snapshotFromSummary,
  yearsToCompare,
  buildYearCompare,
};
