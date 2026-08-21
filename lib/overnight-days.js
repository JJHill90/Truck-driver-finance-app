/**
 * Accumulate LAFHA / travel-allowance days claimed in a financial year
 * versus total days in that FY — for forecast / EOFY planning snapshots.
 */
const { getFinancialYearForDate, getCurrentFinancialYear } = require("./ato-standards");
const { travelRatesForYear } = require("./historical-rates");
const { daysElapsedInFY } = require("./forecast");
const { isPaidLafhaRow } = require("./lafha");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
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

function resolveFy(financialYear, profile = {}) {
  return financialYear || profile.financialYear || getCurrentFinancialYear();
}

function entryInFy(entry, fy) {
  if (!entry || !entry.date) return false;
  try {
    return getFinancialYearForDate(entry.date) === fy;
  } catch {
    return false;
  }
}

/**
 * Resolve LAFHA / travel-allowance days for one income row.
 * Prefer stored overnightDays (API field); else travelAllowanceAmount ÷ meal rate;
 * else paid LAFHA row amount ÷ rate (not full pay-period length).
 */
function overnightDaysForEntry(entry, ratePerDay) {
  if (!entry) return null;
  const stored = num(entry.overnightDays);
  if (stored > 0) {
    return {
      days: Math.round(stored),
      amount: num(entry.travelAllowanceAmount) || null,
      source: entry.overnightDaysSource || "stored",
    };
  }

  const travelAmt = num(entry.travelAllowanceAmount);
  if (travelAmt > 0 && ratePerDay > 0) {
    const days = Math.round(travelAmt / ratePerDay);
    if (days > 0 && days <= 31) {
      return { days, amount: round2(travelAmt), source: "travel_amount" };
    }
  }

  // Dedicated travel / LAFHA income rows: estimate nights from $ ÷ rate.
  // Do not treat a normal payslip as all-travel just because the description
  // mentions Travel Allowance (that would over-count from gross wages).
  if (isPaidLafhaRow(entry)) {
    const type = String(entry.type || "");
    if (type !== "allowance_travel") return null;
    const amount = num(entry.grossTotal != null ? entry.grossTotal : entry.amount);
    if (amount > 0 && ratePerDay > 0) {
      let days = Math.round(amount / ratePerDay);
      // If the slip looks like a weekly pay and days would exceed period, cap.
      const periodDays = inferPayDays(entry);
      if (periodDays && days > periodDays) days = periodDays;
      if (days > 0 && days <= 31) {
        return { days, amount: round2(amount), source: "lafha_row" };
      }
    }
  }

  return null;
}

/**
 * @returns {{
 *   financialYear: string,
 *   determination: string,
 *   ratePerDay: number,
 *   daysClaimed: number,
 *   daysInFy: number,
 *   daysElapsed: number,
 *   daysRemainingInFy: number,
 *   percentOfFyClaimed: number,
 *   amountPaid: number,
 *   entries: array,
 *   note: string
 * }}
 */
function summariseOvernightDays(records = {}, profile = {}, financialYear) {
  const fy = resolveFy(financialYear, profile);
  const rates = travelRatesForYear(fy);
  const ratePerDay = rates.truckDriverMealsDailyTotal;
  const progress = daysElapsedInFY(fy);
  const daysInFy = progress.total;
  const daysElapsed = progress.elapsed;

  const income = Array.isArray(records.income)
    ? records.income
    : Array.isArray(records)
      ? records
      : [];

  const entries = [];
  let daysClaimed = 0;
  let amountPaid = 0;

  for (const row of income) {
    if (!entryInFy(row, fy)) continue;
    const hit = overnightDaysForEntry(row, ratePerDay);
    if (!hit) continue;
    daysClaimed += hit.days;
    if (hit.amount) amountPaid += hit.amount;
    entries.push({
      id: row.id,
      date: row.date,
      days: hit.days,
      amount: hit.amount,
      source: hit.source,
      label: row.description || row.entity || row.payer || "Payslip",
    });
  }

  daysClaimed = Math.round(daysClaimed);
  amountPaid = round2(amountPaid);
  const daysRemainingInFy = Math.max(0, daysInFy - daysClaimed);
  const percentOfFyClaimed =
    daysInFy > 0 ? round2((daysClaimed / daysInFy) * 100) : 0;
  const yearProgress = daysInFy > 0 ? daysElapsed / daysInFy : 0;
  const projectedYearEndDays =
    yearProgress > 0 ? Math.round(daysClaimed / yearProgress) : daysClaimed;

  return {
    financialYear: fy,
    determination: rates.determination,
    ratePerDay: round2(ratePerDay),
    daysClaimed,
    daysInFy,
    daysElapsed,
    daysRemainingInFy,
    percentOfFyClaimed,
    projectedYearEndDays,
    amountPaid,
    entryCount: entries.length,
    entries,
    note: `${rates.determination}: Living Away from Home (LAFHA) / Travel allowance days are taken from the payslip Travel or LAFHA hours/days counter when present, otherwise estimated from Travel/LAFHA $ ÷ the truck-driver meal rate ($${round2(ratePerDay)}/day) for ${rates.incomeYear}. Use this as a planning snapshot of days claimed versus days in the financial year — confirm with your payslips and tax adviser.`,
  };
}

module.exports = {
  summariseOvernightDays,
  overnightDaysForEntry,
  entryInFy,
};
