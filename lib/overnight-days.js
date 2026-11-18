/**
 * Accumulate Travel / LAFHA allowance days claimed in a financial year
 * versus total days in that FY — for dashboard / forecast planning snapshots.
 */
const { getFinancialYearForDate, getCurrentFinancialYear } = require("./ato-standards");
const { travelRatesForYear } = require("./historical-rates");
const { daysElapsedInFY } = require("./forecast");
const { isPaidLafhaRow } = require("./lafha");
const { inferDaysFromTravelAmount } = require("./travel-allowance-extract");

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

function mealRateNote(rates, ratePerDay) {
  const meals = rates.truckDriverMeals || {};
  const b = meals.breakfast && meals.breakfast.cap;
  const l = meals.lunch && meals.lunch.cap;
  const d = meals.dinner && meals.dinner.cap;
  return `${rates.determination} Table 5 (employee truck drivers, ${rates.incomeYear}) sets separate meal amounts — breakfast $${Number(b).toFixed(2)}, lunch $${Number(l).toFixed(2)}, dinner $${Number(d).toFixed(2)}. They cannot be transferred between meals. $${round2(ratePerDay)} is only the sum of those three caps from config, for a day when all three are claimed. Days below come from travel-allowance rows and from overnight meal receipts. Confirm with your payslips and tax adviser.`;
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
    const inferred = inferDaysFromTravelAmount(travelAmt, ratePerDay);
    if (inferred && inferred.days > 0 && inferred.days <= 31) {
      return {
        days: inferred.days,
        amount: round2(travelAmt),
        source: inferred.source === "payslip_amount_div_rate" ? "travel_amount_payroll" : "travel_amount",
      };
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

  const countedDates = new Set();
  for (const row of income) {
    if (!entryInFy(row, fy)) continue;
    const hit = overnightDaysForEntry(row, ratePerDay);
    if (!hit) continue;
    daysClaimed += hit.days;
    if (hit.amount) amountPaid += hit.amount;
    if (row.date) countedDates.add(String(row.date).slice(0, 10));
    entries.push({
      id: row.id,
      date: row.date,
      days: hit.days,
      amount: hit.amount,
      source: hit.source,
      label: row.description || row.entity || row.payer || "Payslip",
    });
  }

  const expenses = Array.isArray(records.expenses) ? records.expenses : [];
  const mealIds = new Set(["meals", "meals_breakfast", "meals_lunch", "meals_dinner", "overtime_meals"]);
  const awayRe = /\b(roadhouse|overnight|nights?\s+away|travel\s+meal)\b/i;
  for (const row of expenses) {
    if (!row || row.deletedAt || !entryInFy(row, fy)) continue;
    const category = String(row.category || "");
    const text = [row.vendor, row.description, row.notes].filter(Boolean).join(" ");
    const overnightMeal =
      row.overnightMeal === true ||
      (mealIds.has(category) && awayRe.test(text));
    if (!overnightMeal) continue;
    const day = String(row.date).slice(0, 10);
    if (countedDates.has(day)) continue;
    countedDates.add(day);
    daysClaimed += 1;
    entries.push({
      id: row.id,
      date: day,
      days: 1,
      amount: num(row.amount) || null,
      source: "overnight_meal_receipt",
      label: row.description || row.vendor || "Overnight meal",
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
    mealCaps: rates.truckDriverMeals,
    note: mealRateNote(rates, ratePerDay),
  };
}

module.exports = {
  summariseOvernightDays,
  overnightDaysForEntry,
  entryInFy,
};
