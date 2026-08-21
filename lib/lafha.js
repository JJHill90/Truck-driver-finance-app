/**
 * Living Away from Home (LAFHA) / Travel allowance helpers.
 *
 * For employee truck drivers, ATO Taxation Determinations set reasonable meal
 * amounts (breakfast + lunch + dinner) when living away from home for work —
 * this app treats that daily meal stack as the LAFHA / Travel reference rate.
 * Rates are income-year aware via lib/historical-rates.js (TD 2025/4 →
 * TD 2026/4, …). Salary band (from profile annual salary or estimated from
 * payslips) is shown for context; the truck-driver meal table itself is not
 * band-dependent.
 */
const { getCurrentFinancialYear } = require("./ato-standards");
const {
  travelRatesForYear,
  getSalaryBandForYear,
} = require("./historical-rates");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

const PAID_LAFHA_RE =
  /\b(living\s*away(?:\s*from\s*home)?|lafha|travel\s*allowance|overnight\s*allowance|driver\s*daily\s*allowance|away\s*from\s*home)\b/i;

function resolveFy(financialYear) {
  return financialYear || getCurrentFinancialYear();
}

function truckDriverMealsDaily(financialYear) {
  const rates = travelRatesForYear(resolveFy(financialYear));
  return rates.truckDriverMealsDailyTotal;
}

function bandDailyTravelTotal(bandId, financialYear) {
  const rates = travelRatesForYear(resolveFy(financialYear));
  const caps = rates.domesticTravelDaily[bandId] || rates.domesticTravelDaily.band1;
  return round2(
    num(caps.accommodation) +
      num(caps.breakfast) +
      num(caps.lunch) +
      num(caps.dinner) +
      num(caps.incidentals)
  );
}

function bandLabel(bandId, financialYear) {
  const rates = travelRatesForYear(resolveFy(financialYear));
  const meta = (rates.salaryBands || []).find((b) => b.id === bandId);
  return meta ? meta.label : bandId;
}

/**
 * Prefer profile.annualSalary; otherwise annualise average weekly/fortnightly
 * gross from recorded payslips / remittances.
 */
function resolveAnnualSalary(profile = {}, income = []) {
  const fromProfile = num(profile.annualSalary);
  if (fromProfile > 0) {
    return { amount: round2(fromProfile), source: "profile" };
  }

  const pays = (income || []).filter((row) => {
    const kind = String(row.documentKind || "").toLowerCase();
    const type = String(row.type || "").toLowerCase();
    return (
      kind === "payslip" ||
      kind === "remittance" ||
      type === "salary_wages" ||
      num(row.grossTotal || row.amount) > 0
    );
  });
  if (!pays.length) return { amount: 0, source: "none" };

  const sample = pays
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);

  let totalGross = 0;
  let totalDays = 0;
  for (const row of sample) {
    const gross = num(row.grossTotal != null ? row.grossTotal : row.amount);
    if (gross <= 0) continue;
    const days = inferPayDays(row) || 7;
    totalGross += gross;
    totalDays += days;
  }
  if (totalDays <= 0 || totalGross <= 0) return { amount: 0, source: "none" };
  const daily = totalGross / totalDays;
  return { amount: round2(daily * 365), source: "payslips" };
}

function inferPayDays(row) {
  const text = [row.payPeriod, row.reference, row.description, row.summaryNotes]
    .filter(Boolean)
    .join(" ");
  if (/fortnight|14\s*day|bi[-\s]?week/i.test(text)) return 14;
  if (/month/i.test(text)) return 30;
  if (/week|7\s*day/i.test(text)) return 7;
  if (row.payPeriod && typeof row.payPeriod === "object") {
    const from = row.payPeriod.from;
    const to = row.payPeriod.to;
    if (from && to) {
      const a = new Date(`${from}T00:00:00`);
      const b = new Date(`${to}T00:00:00`);
      const days = Math.round((b - a) / 86400000) + 1;
      if (days > 0 && days < 40) return days;
    }
  }
  return 7;
}

function textBlob(row) {
  return [
    row.type,
    row.description,
    row.summaryNotes,
    row.reference,
    row.payPeriod && typeof row.payPeriod === "string" ? row.payPeriod : "",
    row.entity,
    row.payer,
  ]
    .filter(Boolean)
    .join(" ");
}

function isPaidLafhaRow(row) {
  if (!row) return false;
  if (String(row.type || "") === "allowance_travel") return true;
  if (PAID_LAFHA_RE.test(textBlob(row))) return true;
  return false;
}

/**
 * Collect LAFHA / travel allowance amounts paid on income rows (manual or
 * from scanned payslips whose description/notes mention the allowance).
 */
function collectPaidLafha(income = []) {
  const rows = [];
  for (const row of income || []) {
    if (!isPaidLafhaRow(row)) continue;
    const amount = num(row.grossTotal != null ? row.grossTotal : row.amount);
    if (amount <= 0) continue;
    const days = inferPayDays(row) || null;
    rows.push({
      id: row.id,
      date: row.date,
      amount: round2(amount),
      days,
      perDay: days ? round2(amount / days) : null,
      label: row.description || row.summaryNotes || "Travel / LAFHA allowance",
    });
  }
  const totalPaid = round2(rows.reduce((s, r) => s + r.amount, 0));
  const daysKnown = rows.filter((r) => r.days > 0);
  const totalDays = daysKnown.reduce((s, r) => s + r.days, 0);
  const avgPerDay =
    totalDays > 0 ? round2(daysKnown.reduce((s, r) => s + r.amount, 0) / totalDays) : null;
  return { rows, totalPaid, avgPerDay, entryCount: rows.length };
}

/**
 * Full LAFHA snapshot for dashboard / income panels.
 * @param {object} profile
 * @param {array} income
 * @param {string} [financialYear] Australian FY e.g. "2026-27"
 */
function summariseLafha(profile = {}, income = [], financialYear) {
  const fy = resolveFy(financialYear || profile.financialYear);
  const rates = travelRatesForYear(fy);
  const salary = resolveAnnualSalary(profile, income);
  const band = getSalaryBandForYear(salary.amount || 0, fy);
  const meals = rates.truckDriverMeals;
  const mealsDaily = rates.truckDriverMealsDailyTotal;
  const generalTravelDaily = bandDailyTravelTotal(band, fy);
  const paid = collectPaidLafha(income);
  const driverType = profile.driverType || "long_haul";

  return {
    driverType,
    financialYear: fy,
    determination: rates.determination,
    salary,
    salaryBand: band,
    salaryBandLabel: bandLabel(band, fy),
    reasonablePerDay: mealsDaily,
    reasonableBreakdown: {
      breakfast: num(meals.breakfast.cap),
      lunch: num(meals.lunch.cap),
      dinner: num(meals.dinner.cap),
    },
    overtimeMealCap: rates.overtimeMealCap,
    generalTravelPerDay: generalTravelDaily,
    paid,
    note: `${rates.determination} Table 5 — employee truck driver meal reasonable amounts for income year ${rates.incomeYear} when living away from home for work. Meals only (excludes accommodation). Claim actual spend up to this daily amount when a Travel / Living Away from Home (LAFHA) allowance was paid. ATO updates these annually (not Jan/Jul).`,
  };
}

module.exports = {
  truckDriverMealsDaily,
  bandDailyTravelTotal,
  resolveAnnualSalary,
  collectPaidLafha,
  summariseLafha,
  isPaidLafhaRow,
  PAID_LAFHA_RE,
};
