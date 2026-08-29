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

/**
 * ATO Taxation Determination reasonable travel / overtime meal amounts by income year.
 * These are annual (1 Jul–30 Jun), not Jan/Jul award wage adjustments.
 * Latest known TD is reused until the next determination is published.
 *
 * Truck-driver meal caps come from each TD’s employee truck driver table.
 * domesticTravelDaily uses “other country centres” (band 1–2) / country-centre
 * floor (band 3) as a single representative stack — the app does not model
 * capital-city tables.
 */
const TRAVEL_RATE_SETS = {
  // TD 2021/6 — 2021–22 (also best-effort for earlier years in the FY window).
  td2021_6: {
    determination: "TD 2021/6",
    incomeYear: "2021-22",
    overtimeMealCap: 32.5,
    truckDriverMeals: {
      breakfast: { cap: 26.15, label: "Breakfast (truck driver)", substantiation: "reasonable_amount" },
      lunch: { cap: 29.85, label: "Lunch (truck driver)", substantiation: "reasonable_amount" },
      dinner: { cap: 51.5, label: "Dinner (truck driver)", substantiation: "reasonable_amount" },
    },
    salaryBands: [
      { id: "band1", label: "Up to $129,250", maxSalary: 129250 },
      { id: "band2", label: "$129,251 – $230,050", maxSalary: 230050 },
      { id: "band3", label: "$230,051 or more", maxSalary: Infinity },
    ],
    domesticTravelDaily: {
      band1: { accommodation: 118.0, breakfast: 26.15, lunch: 29.85, dinner: 51.5, incidentals: 20.6 },
      band2: { accommodation: 142.0, breakfast: 29.2, lunch: 29.85, dinner: 58.2, incidentals: 29.45 },
      band3: { accommodation: 195.0, breakfast: 37.5, lunch: 53.1, dinner: 74.3, incidentals: 29.45 },
    },
  },
  // TD 2022/10 — 2022–23.
  td2022_10: {
    determination: "TD 2022/10",
    incomeYear: "2022-23",
    overtimeMealCap: 33.25,
    truckDriverMeals: {
      breakfast: { cap: 26.8, label: "Breakfast (truck driver)", substantiation: "reasonable_amount" },
      lunch: { cap: 30.6, label: "Lunch (truck driver)", substantiation: "reasonable_amount" },
      dinner: { cap: 52.75, label: "Dinner (truck driver)", substantiation: "reasonable_amount" },
    },
    salaryBands: [
      { id: "band1", label: "Up to $133,450", maxSalary: 133450 },
      { id: "band2", label: "$133,451 – $237,520", maxSalary: 237520 },
      { id: "band3", label: "$237,521 or more", maxSalary: Infinity },
    ],
    domesticTravelDaily: {
      band1: { accommodation: 121.0, breakfast: 26.8, lunch: 30.6, dinner: 52.75, incidentals: 21.3 },
      band2: { accommodation: 145.0, breakfast: 29.9, lunch: 30.6, dinner: 59.6, incidentals: 30.5 },
      band3: { accommodation: 195.0, breakfast: 38.2, lunch: 54.05, dinner: 75.65, incidentals: 30.5 },
    },
  },
  // TD 2023/3 — 2023–24.
  td2023_3: {
    determination: "TD 2023/3",
    incomeYear: "2023-24",
    overtimeMealCap: 35.65,
    truckDriverMeals: {
      breakfast: { cap: 28.75, label: "Breakfast (truck driver)", substantiation: "reasonable_amount" },
      lunch: { cap: 32.8, label: "Lunch (truck driver)", substantiation: "reasonable_amount" },
      dinner: { cap: 56.6, label: "Dinner (truck driver)", substantiation: "reasonable_amount" },
    },
    salaryBands: [
      { id: "band1", label: "Up to $138,790", maxSalary: 138790 },
      { id: "band2", label: "$138,791 – $247,020", maxSalary: 247020 },
      { id: "band3", label: "$247,021 or more", maxSalary: Infinity },
    ],
    domesticTravelDaily: {
      band1: { accommodation: 141.0, breakfast: 28.75, lunch: 32.8, dinner: 56.6, incidentals: 23.0 },
      band2: { accommodation: 188.0, breakfast: 32.1, lunch: 32.8, dinner: 63.95, incidentals: 32.9 },
      band3: { accommodation: 195.0, breakfast: 38.9, lunch: 55.0, dinner: 77.0, incidentals: 32.9 },
    },
  },
  // TD 2024/3 — 2024–25.
  td2024_3: {
    determination: "TD 2024/3",
    incomeYear: "2024-25",
    overtimeMealCap: 37.65,
    truckDriverMeals: {
      breakfast: { cap: 30.35, label: "Breakfast (truck driver)", substantiation: "reasonable_amount" },
      lunch: { cap: 34.65, label: "Lunch (truck driver)", substantiation: "reasonable_amount" },
      dinner: { cap: 59.75, label: "Dinner (truck driver)", substantiation: "reasonable_amount" },
    },
    salaryBands: [
      { id: "band1", label: "Up to $143,650", maxSalary: 143650 },
      { id: "band2", label: "$143,651 – $255,670", maxSalary: 255670 },
      { id: "band3", label: "$255,671 or more", maxSalary: Infinity },
    ],
    domesticTravelDaily: {
      band1: { accommodation: 141.0, breakfast: 30.35, lunch: 34.65, dinner: 59.75, incidentals: 23.95 },
      band2: { accommodation: 188.0, breakfast: 33.9, lunch: 34.65, dinner: 67.5, incidentals: 34.25 },
      band3: { accommodation: 207.0, breakfast: 41.1, lunch: 58.1, dinner: 81.3, incidentals: 34.25 },
    },
  },
  // TD 2025/4 — 2025–26.
  td2025_4: {
    determination: "TD 2025/4",
    incomeYear: "2025-26",
    overtimeMealCap: 38.65,
    truckDriverMeals: {
      breakfast: { cap: 31.15, label: "Breakfast (truck driver)", substantiation: "reasonable_amount" },
      lunch: { cap: 35.55, label: "Lunch (truck driver)", substantiation: "reasonable_amount" },
      dinner: { cap: 61.3, label: "Dinner (truck driver)", substantiation: "reasonable_amount" },
    },
    salaryBands: [
      { id: "band1", label: "Up to $148,250", maxSalary: 148250 },
      { id: "band2", label: "$148,251 – $263,850", maxSalary: 263850 },
      { id: "band3", label: "$263,851 or more", maxSalary: Infinity },
    ],
    // Simplified single daily caps (app does not model city tables).
    domesticTravelDaily: {
      band1: { accommodation: 138.0, breakfast: 31.15, lunch: 35.55, dinner: 61.3, incidentals: 24.25 },
      band2: { accommodation: 175.0, breakfast: 36.8, lunch: 42.15, dinner: 72.6, incidentals: 27.65 },
      band3: { accommodation: 210.0, breakfast: 42.15, lunch: 59.6, dinner: 83.4, incidentals: 32.05 },
    },
  },
  // TD 2026/4 — 2026–27 onwards until the next TD ships.
  td2026_4: {
    determination: "TD 2026/4",
    incomeYear: "2026-27",
    overtimeMealCap: 40,
    truckDriverMeals: {
      breakfast: { cap: 32.25, label: "Breakfast (truck driver)", substantiation: "reasonable_amount" },
      lunch: { cap: 36.8, label: "Lunch (truck driver)", substantiation: "reasonable_amount" },
      dinner: { cap: 63.45, label: "Dinner (truck driver)", substantiation: "reasonable_amount" },
    },
    salaryBands: [
      { id: "band1", label: "Up to $153,210", maxSalary: 153210 },
      { id: "band2", label: "$153,211 – $272,680", maxSalary: 272680 },
      { id: "band3", label: "$272,681 or more", maxSalary: Infinity },
    ],
    // Other-country / representative daily rates from TD 2026/4 Tables 1–3.
    domesticTravelDaily: {
      band1: { accommodation: 141.0, breakfast: 32.25, lunch: 36.8, dinner: 63.45, incidentals: 25.4 },
      band2: { accommodation: 188.0, breakfast: 36.0, lunch: 36.8, dinner: 71.45, incidentals: 36.3 },
      band3: { accommodation: 207.0, breakfast: 43.65, lunch: 61.7, dinner: 86.35, incidentals: 36.3 },
    },
  },
};

function travelRateSetForYear(fy) {
  const y = startYear(fy);
  if (y >= 2026) return TRAVEL_RATE_SETS.td2026_4;
  if (y >= 2025) return TRAVEL_RATE_SETS.td2025_4;
  if (y >= 2024) return TRAVEL_RATE_SETS.td2024_3;
  if (y >= 2023) return TRAVEL_RATE_SETS.td2023_3;
  if (y >= 2022) return TRAVEL_RATE_SETS.td2022_10;
  return TRAVEL_RATE_SETS.td2021_6;
}

function travelRatesForYear(fy) {
  const set = travelRateSetForYear(fy);
  const meals = set.truckDriverMeals;
  const daily = round2(meals.breakfast.cap + meals.lunch.cap + meals.dinner.cap);
  return {
    financialYear: fy || set.incomeYear,
    determination: set.determination,
    incomeYear: set.incomeYear,
    overtimeMealCap: set.overtimeMealCap,
    truckDriverMeals: meals,
    truckDriverMealsDailyTotal: daily,
    salaryBands: set.salaryBands,
    domesticTravelDaily: set.domesticTravelDaily,
  };
}

function getSalaryBandForYear(annualSalary, fy) {
  const bands = travelRateSetForYear(fy).salaryBands;
  const amount = Number(annualSalary) || 0;
  if (amount <= bands[0].maxSalary) return "band1";
  if (amount <= bands[1].maxSalary) return "band2";
  return "band3";
}

function truckDriverMealsForYear(fy) {
  return travelRateSetForYear(fy).truckDriverMeals;
}

function overtimeMealCapForYear(fy) {
  return travelRateSetForYear(fy).overtimeMealCap;
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

  // Overlay year-correct travel / LAFHA / overtime meal reasonable amounts.
  const travel = travelRatesForYear(fy);
  const annualSalary =
    (summary.profile && summary.profile.annualSalary) ||
    (summary.income && summary.income.assessableTotal) ||
    0;
  const band = getSalaryBandForYear(annualSalary, fy);
  const travelCaps = travel.domesticTravelDaily[band] || travel.domesticTravelDaily.band1;
  summary.allowances = {
    ...(summary.allowances || {}),
    truckDriverMealsDaily: travel.truckDriverMeals,
    overtimeMealCap: travel.overtimeMealCap,
    maxDailyMealsPotential: travel.truckDriverMealsDailyTotal,
    domesticTravelCaps: travelCaps,
    determination: travel.determination,
    ratesFinancialYear: fy,
  };
  if (summary.profile) {
    summary.profile.salaryBand = band;
    summary.profile.travelCaps = travelCaps;
  }
  return summary;
}

module.exports = {
  bracketsForYear,
  incomeTaxForYear,
  medicareLevyForYear,
  budgetRepairLevy,
  centsPerKmForYear,
  sgRateForYear,
  travelRateSetForYear,
  travelRatesForYear,
  getSalaryBandForYear,
  truckDriverMealsForYear,
  overtimeMealCapForYear,
  deductionForYear,
  applyHistoricalRates,
  TRAVEL_RATE_SETS,
};
