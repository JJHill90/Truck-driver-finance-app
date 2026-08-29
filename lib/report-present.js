/**
 * Presentation layer for EOFY accountant reports (on-screen JSON + PDF).
 * Keeps verbatim tax-calculator / ato-standards labels in place while the
 * downloadable and live reports show the same category names as Taxation Hub
 * menus, and income totals that prefer taxable/gross over net-pay `amount`.
 */
const { getCategoryMeta, INCOME_TYPES } = require("./ato-standards");
const {
  LABEL_OVERRIDES: EXPENSE_LABEL_OVERRIDES,
  MEAL_LABEL_OVERRIDES,
  CAR_CLAIM_LABEL_OVERRIDES,
  ensureMealsRegistered,
} = require("./expense-menu");
const { LABEL_OVERRIDES: INCOME_LABEL_OVERRIDES } = require("./income-menu");
const { summariseOvernightDays } = require("./overnight-days");

ensureMealsRegistered();

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

/** Display label for an expense category id (menus + PDF ledger). */
function presentExpenseLabel(categoryId) {
  const id = String(categoryId || "");
  if (EXPENSE_LABEL_OVERRIDES[id]) return EXPENSE_LABEL_OVERRIDES[id];
  if (MEAL_LABEL_OVERRIDES[id]) return MEAL_LABEL_OVERRIDES[id];
  if (CAR_CLAIM_LABEL_OVERRIDES[id]) return CAR_CLAIM_LABEL_OVERRIDES[id];
  const meta = getCategoryMeta(id);
  return (meta && meta.label) || id.replace(/_/g, " ") || "—";
}

/** Display label for an income type id. */
function presentIncomeTypeLabel(typeId) {
  const id = String(typeId || "");
  if (INCOME_LABEL_OVERRIDES[id]) return INCOME_LABEL_OVERRIDES[id];
  const meta = INCOME_TYPES[id];
  return (meta && meta.label) || id.replace(/_/g, " ") || "—";
}

/**
 * Prefer taxable income / gross for accountant totals. Ledger `amount` is often
 * net pay after the income-scan primary preference.
 */
function assessableIncomeAmount(entry) {
  if (!entry) return 0;
  if (num(entry.taxableIncome) > 0) return round2(entry.taxableIncome);
  if (num(entry.grossTotal) > 0) return round2(entry.grossTotal);
  return round2(entry.amount);
}

/**
 * Shallow-clone records so summariseYear uses assessable bases without mutating
 * stored net-pay `amount` values.
 */
function recordsForAccountantReport(records = {}) {
  const income = (records.income || []).map((row) => {
    const assessable = assessableIncomeAmount(row);
    return {
      ...row,
      amount: assessable > 0 ? assessable : num(row.amount),
    };
  });
  return { ...records, income, expenses: records.expenses || [] };
}

/**
 * Days-only LAFHA / Travel allowance snapshot for the EOFY working paper.
 * Omits dollar totals (amountPaid / per-entry amounts).
 */
function presentLafhaDays(records, profile, financialYear) {
  const raw = summariseOvernightDays(records, profile || {}, financialYear);
  return {
    financialYear: raw.financialYear,
    determination: raw.determination,
    ratePerDay: raw.ratePerDay,
    daysClaimed: raw.daysClaimed,
    daysInFy: raw.daysInFy,
    daysElapsed: raw.daysElapsed,
    daysRemainingInFy: raw.daysRemainingInFy,
    percentOfFyClaimed: raw.percentOfFyClaimed,
    projectedYearEndDays: raw.projectedYearEndDays,
    entryCount: raw.entryCount,
    entries: (raw.entries || []).map((e) => ({
      id: e.id,
      date: e.date,
      days: e.days,
      source: e.source,
      label: e.label,
    })),
    note:
      raw.note ||
      "Travel / Living Away from Home (LAFHA) days claimed versus days in the financial year (counter only — not dollar totals).",
  };
}

/**
 * Relabel income/expense schedules and attach LAFHA days after the accountant
 * report (+ historical rates) are built.
 */
function decorateReportPresentation(report, records, financialYear) {
  if (!report || typeof report !== "object") return report;
  const summary = report.summary || {};
  const fy = financialYear || summary.financialYear || (records.profile && records.profile.financialYear);

  for (const b of summary.income?.breakdown || []) {
    b.label = presentIncomeTypeLabel(b.type || b.label);
  }
  for (const b of summary.expenses?.breakdown || []) {
    b.label = presentExpenseLabel(b.category || b.label);
  }
  if (Array.isArray(report.atoScheduleMapping)) {
    for (const row of report.atoScheduleMapping) {
      if (row && row.category) {
        // Prefer matching breakdown by deductible amount+schedule when possible;
        // mapping already copied labels — refresh from expense breakdown ids.
      }
    }
    // Rebuild mapping labels from the (now presented) expense breakdown.
    report.atoScheduleMapping = (summary.expenses?.breakdown || []).map((b) => ({
      schedule: b.atoSchedule,
      category: b.label,
      deductibleAmount: b.deductibleTotal,
      transactionCount: b.count,
    }));
  }
  if (Array.isArray(report.incomeSchedule)) {
    report.incomeSchedule = (summary.income?.breakdown || []).map((b) => ({
      type: b.label,
      assessableAmount: b.assessableTotal,
      grossAmount: b.grossTotal,
      count: b.count,
    }));
  }

  report.lafhaDays = presentLafhaDays(records, records.profile || summary.profile || {}, fy);
  return report;
}

module.exports = {
  presentExpenseLabel,
  presentIncomeTypeLabel,
  assessableIncomeAmount,
  recordsForAccountantReport,
  presentLafhaDays,
  decorateReportPresentation,
};
