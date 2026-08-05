/**
 * Living Away from Home / overnight travel allowance helpers.
 *
 * For employee truck drivers, ATO TD 2025/4 Table 5 sets reasonable meal
 * amounts (breakfast + lunch + dinner) when travelling away overnight — this
 * app treats that daily meal stack as the LAFHA / overnight reference rate.
 * Salary band (from profile annual salary or estimated from payslips) is shown
 * for context; the truck-driver meal table itself is not band-dependent.
 */
const {
  TRUCK_DRIVER_MEALS,
  DOMESTIC_TRAVEL_DAILY,
  getSalaryBand,
  SALARY_BANDS,
} = require("./ato-standards");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

const PAID_LAFHA_RE =
  /\b(living\s*away(?:\s*from\s*home)?|lafha|travel\s*allowance|overnight\s*allowance|driver\s*daily\s*allowance|away\s*from\s*home)\b/i;

function truckDriverMealsDaily() {
  return round2(
    num(TRUCK_DRIVER_MEALS.breakfast.cap) +
      num(TRUCK_DRIVER_MEALS.lunch.cap) +
      num(TRUCK_DRIVER_MEALS.dinner.cap)
  );
}

function bandDailyTravelTotal(bandId) {
  const caps = DOMESTIC_TRAVEL_DAILY[bandId] || DOMESTIC_TRAVEL_DAILY.band1;
  return round2(
    num(caps.accommodation) +
      num(caps.breakfast) +
      num(caps.lunch) +
      num(caps.dinner) +
      num(caps.incidentals)
  );
}

function bandLabel(bandId) {
  const meta = SALARY_BANDS.find((b) => b.id === bandId);
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

  // Use up to the latest 8 pays; infer period length from payPeriod text or default 7 days.
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
  const range = text.match(
    /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}).{0,12}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/
  );
  if (range) {
    // Can't reliably parse without aus-date — fall through to keywords.
  }
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
 */
function summariseLafha(profile = {}, income = []) {
  const salary = resolveAnnualSalary(profile, income);
  const band = getSalaryBand(salary.amount || 0);
  const mealsDaily = truckDriverMealsDaily();
  const generalTravelDaily = bandDailyTravelTotal(band);
  const paid = collectPaidLafha(income);
  const driverType = profile.driverType || "long_haul";

  return {
    driverType,
    salary,
    salaryBand: band,
    salaryBandLabel: bandLabel(band),
    reasonablePerDay: mealsDaily,
    reasonableBreakdown: {
      breakfast: num(TRUCK_DRIVER_MEALS.breakfast.cap),
      lunch: num(TRUCK_DRIVER_MEALS.lunch.cap),
      dinner: num(TRUCK_DRIVER_MEALS.dinner.cap),
    },
    generalTravelPerDay: generalTravelDaily,
    paid,
    note:
      "ATO TD 2025/4 Table 5 — employee truck driver meal reasonable amounts when living/travelling away overnight. Meals only (excludes accommodation). Claim actual spend up to this daily amount when a travel / living-away allowance was paid.",
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
