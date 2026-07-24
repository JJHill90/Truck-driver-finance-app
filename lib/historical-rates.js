/**
 * Year-aware ATO rates so prior financial years reconcile against the rules that
 * actually applied that year. Figures verified against ATO sources:
 *  - Resident income tax brackets (ato.gov.au "Tax rates – Australian resident").
 *  - Temporary Budget Repair Levy: +2% over $180,000 for 2014-15 to 2016-17.
 *  - Cents-per-km car rate by year. Super Guarantee rate by year. Medicare 2%.
 *
 * This is a first-party layer; the provided tax-calculator/ato-standards modules
 * are left untouched. Applied by overlaying corrected figures onto the summary.
 */
const { calcExpenseDeduction, round2 } = require("./tax-calculator");
const { getFinancialYearForDate } = require("./ato-standards");

const MEDICARE_LEVY_RATE = 0.02;

// Marginal resident tax brackets by era (rates exclude Medicare). Each ends at Infinity.
const BRACKET_SETS = {
  preStage3_80k: [
    { upTo: 18200, rate: 0 },
    { upTo: 37000, rate: 0.19 },
    { upTo: 80000, rate: 0.325 },
    { upTo: 180000, rate: 0.37 },
    { upTo: Infinity, rate: 0.45 },
  ],
  bracket_87k: [
    { upTo: 18200, rate: 0 },
    { upTo: 37000, rate: 0.19 },
    { upTo: 87000, rate: 0.325 },
    { upTo: 180000, rate: 0.37 },
    { upTo: Infinity, rate: 0.45 },
  ],
  bracket_90k: [
    { upTo: 18200, rate: 0 },
    { upTo: 37000, rate: 0.19 },
    { upTo: 90000, rate: 0.325 },
    { upTo: 180000, rate: 0.37 },
    { upTo: Infinity, rate: 0.45 },
  ],
  stage2: [
    { upTo: 18200, rate: 0 },
    { upTo: 45000, rate: 0.19 },
    { upTo: 120000, rate: 0.325 },
    { upTo: 180000, rate: 0.37 },
    { upTo: Infinity, rate: 0.45 },
  ],
  stage3: [
    { upTo: 18200, rate: 0 },
    { upTo: 45000, rate: 0.16 },
    { upTo: 135000, rate: 0.3 },
    { upTo: 190000, rate: 0.37 },
    { upTo: Infinity, rate: 0.45 },
  ],
};

function startYear(fy) {
  return Number(String(fy || "").split("-")[0]) || 0;
}

function bracketsForYear(fy) {
  const y = startYear(fy);
  if (y <= 2015) return BRACKET_SETS.preStage3_80k; // 2015-16 (and earlier as best-effort)
  if (y <= 2017) return BRACKET_SETS.bracket_87k; // 2016-17, 2017-18
  if (y <= 2019) return BRACKET_SETS.bracket_90k; // 2018-19, 2019-20
  if (y <= 2023) return BRACKET_SETS.stage2; // 2020-21 .. 2023-24
  return BRACKET_SETS.stage3; // 2024-25 onwards
}

function incomeTaxForYear(taxableIncome, fy) {
  const t = Math.max(0, Number(taxableIncome) || 0);
  let tax = 0;
  let prev = 0;
  for (const b of bracketsForYear(fy)) {
    const band = Math.min(t, b.upTo) - prev;
    if (band > 0) tax += band * b.rate;
    prev = b.upTo;
    if (t <= b.upTo) break;
  }
  return round2(tax);
}

function medicareLevyForYear(taxableIncome) {
  return round2(Math.max(0, Number(taxableIncome) || 0) * MEDICARE_LEVY_RATE);
}

/** Temporary Budget Repair Levy: 2% over $180k for FY2014-15 to FY2016-17. */
function budgetRepairLevy(taxableIncome, fy) {
  const y = startYear(fy);
  const t = Number(taxableIncome) || 0;
  if (y >= 2014 && y <= 2016 && t > 180000) return round2((t - 180000) * 0.02);
  return 0;
}

function centsPerKmForYear(fy) {
  const y = startYear(fy);
  if (y <= 2017) return 0.66; // 2015-16, 2016-17, 2017-18
  if (y <= 2019) return 0.68; // 2018-19, 2019-20
  if (y <= 2021) return 0.72; // 2020-21, 2021-22
  if (y === 2022) return 0.78;
  if (y === 2023) return 0.85;
  if (y <= 2025) return 0.88; // 2024-25, 2025-26
  return 0.91; // 2026-27 onwards
}

function sgRateForYear(fy) {
  const y = startYear(fy);
  if (y <= 2020) return 0.095; // frozen 2014-15 .. 2020-21
  if (y === 2021) return 0.1;
  if (y === 2022) return 0.105;
  if (y === 2023) return 0.11;
  if (y === 2024) return 0.115;
  return 0.12; // 2025-26 onwards
}

/** Deduction for one expense using the selected year's rate-dependent rules. */
function deductionForYear(entry, fy) {
  const base = calcExpenseDeduction(entry);
  if (entry.category === "vehicle_car" && entry.method === "cents_per_km") {
    const km = Math.min(Number(entry.kilometres) || 0, 5000);
    const deductible = round2(km * centsPerKmForYear(fy));
    return { ...base, deductibleAmount: deductible, cappedAmount: deductible };
  }
  return base;
}

/**
 * Overlay year-correct rates onto a summary produced by the provided
 * summariseYear(): recomputes rate-dependent deductions (cents-per-km), the
 * taxable income, and the tax estimate (brackets + Medicare + budget repair levy).
 * Income assessability and expense caps that haven't changed are left as-is.
 */
function applyHistoricalRates(summary, records, financialYear) {
  const fy = financialYear || summary.financialYear;
  const expenses = (records.expenses || []).filter((e) => getFinancialYearForDate(e.date) === fy);

  let deductibleTotal = 0;
  const byCategory = {};
  for (const e of expenses) {
    const d = deductionForYear(e, fy).deductibleAmount;
    deductibleTotal = round2(deductibleTotal + d);
    byCategory[e.category] = round2((byCategory[e.category] || 0) + d);
  }

  summary.expenses.deductibleTotal = deductibleTotal;
  for (const b of summary.expenses.breakdown || []) {
    if (byCategory[b.category] != null) b.deductibleTotal = byCategory[b.category];
  }

  const assessable = summary.income.assessableTotal || 0;
  const taxable = round2(Math.max(0, assessable - deductibleTotal));
  const incomeTax = incomeTaxForYear(taxable, fy);
  const medicare = medicareLevyForYear(taxable);
  const levy = budgetRepairLevy(taxable, fy);
  const totalTax = round2(incomeTax + medicare + levy);

  summary.taxEstimate = {
    taxableIncome: taxable,
    incomeTax,
    medicareLevy: medicare,
    budgetRepairLevy: levy,
    totalTax,
    effectiveRate: assessable > 0 ? round2((totalTax / assessable) * 100) : 0,
    ratesFinancialYear: fy,
  };
  return summary;
}

module.exports = {
  bracketsForYear,
  incomeTaxForYear,
  medicareLevyForYear,
  budgetRepairLevy,
  centsPerKmForYear,
  sgRateForYear,
  deductionForYear,
  applyHistoricalRates,
};
