/**
 * EOFY forecast for Go Taxation Suite — same Conservative / Baseline / Optimistic
 * layout as Taxation Hub, using the general tax engine.
 */

const { summariseYear, round2 } = require("./tax");
const { getFinancialYearForDate, incomeTaxForYear, budgetRepairLevy, calcLito, calcMedicareLevyShaded } = require("./ato");

function daysBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
}

function daysElapsedInFY(fyLabel) {
  const [startYear] = fyLabel.split("-").map(Number);
  const fyStart = new Date(startYear, 6, 1);
  const fyEnd = new Date(startYear + 1, 5, 30);
  const now = new Date();
  if (now < fyStart) return { elapsed: 0, total: daysBetween(fyStart, fyEnd), fyStart, fyEnd };
  if (now > fyEnd) return { elapsed: daysBetween(fyStart, fyEnd), total: daysBetween(fyStart, fyEnd), fyStart, fyEnd };
  return {
    elapsed: daysBetween(fyStart, now),
    total: daysBetween(fyStart, fyEnd),
    fyStart,
    fyEnd,
  };
}

function taxOn(taxable, fy) {
  const raw = incomeTaxForYear(taxable, fy);
  const lito = calcLito(taxable);
  const incomeTax = round2(Math.max(0, raw - lito));
  const medicare = calcMedicareLevyShaded(taxable, fy);
  const levy = budgetRepairLevy(taxable, fy);
  return round2(incomeTax + medicare + levy);
}

function buildForecast(records, profile = {}, manual = {}) {
  const fy = profile.financialYear || getFinancialYearForDate(new Date().toISOString().slice(0, 10));
  const ytd = summariseYear(records, { ...profile, financialYear: fy });
  const { elapsed, total } = daysElapsedInFY(fy);
  const progress = total > 0 ? elapsed / total : 0;
  const useManual = manual.mode === "manual";

  const projectedIncome = useManual
    ? Number(manual.projectedIncome) || 0
    : progress > 0
      ? round2(ytd.income.assessableTotal / progress)
      : ytd.income.assessableTotal;

  const projectedDeductions = useManual
    ? Number(manual.projectedDeductions) || 0
    : progress > 0
      ? round2(ytd.expenses.deductibleTotal / progress)
      : ytd.expenses.deductibleTotal;

  const projectedTaxable = round2(Math.max(0, projectedIncome - projectedDeductions));
  const projectedTotalTax = taxOn(projectedTaxable, fy);
  const projectedPayg =
    progress > 0 ? round2((ytd.income.paygWithheld || 0) / progress) : ytd.income.paygWithheld || 0;

  const scenarios = [
    { name: "Conservative", incomeMultiplier: 0.9, deductionMultiplier: 1.0 },
    { name: "Baseline", incomeMultiplier: 1.0, deductionMultiplier: 1.0 },
    { name: "Optimistic", incomeMultiplier: 1.1, deductionMultiplier: 1.05 },
  ].map((s) => {
    const inc = round2(projectedIncome * s.incomeMultiplier);
    const ded = round2(projectedDeductions * s.deductionMultiplier);
    const taxable = round2(Math.max(0, inc - ded));
    const tax = taxOn(taxable, fy);
    return {
      ...s,
      projectedIncome: inc,
      projectedDeductions: ded,
      projectedTaxable: taxable,
      projectedTax: tax,
      projectedNet: round2(inc - tax),
    };
  });

  return {
    financialYear: fy,
    mode: useManual ? "manual" : "realtime",
    product: "gotax",
    yearProgress: {
      daysElapsed: elapsed,
      daysTotal: total,
      percentComplete: round2(progress * 100),
    },
    yearToDate: {
      income: ytd.income.assessableTotal,
      deductions: ytd.expenses.deductibleTotal,
      taxableIncome: ytd.taxEstimate.taxableIncome,
      estimatedTax: ytd.taxEstimate.totalTax,
      paygWithheld: ytd.income.paygWithheld,
    },
    projected: {
      income: projectedIncome,
      deductions: projectedDeductions,
      taxableIncome: projectedTaxable,
      totalTax: projectedTotalTax,
      paygWithheld: projectedPayg,
      taxPayable: round2(projectedTotalTax - projectedPayg),
      netAfterTax: round2(projectedIncome - projectedTotalTax),
      averageMonthlyNet: projectedIncome > 0 ? round2((projectedIncome - projectedTotalTax) / 12) : 0,
    },
    scenarios,
    manualInputs: useManual ? manual : null,
  };
}

module.exports = { buildForecast, daysElapsedInFY };
