/**
 * Ordinary-employee work travel and LAFHA amounts for Go Taxation Suite.
 *
 * Work travel nights / allowance caps use Taxation Determination Tables 1–3
 * (capital-city / high-cost meal amounts). Melbourne accommodation is the
 * representative capital because this app does not model city tables.
 * Those tables do not apply to employee truck drivers (e.g. TD 2025/4 para 12
 * — truck drivers use Table 5 meals only).
 *
 * Living-away-from-home for sales, marketing and similar occupations is the
 * FBT food component (TD 2025/2 / TD 2026/2 weekly amounts), not the truck
 * driver daily meal stack.
 *
 * Overtime meal (s 900-60) is a separate exception from overnight travel.
 */

const { getCurrentFinancialYear, getFinancialYearForDate } = require("../ato-standards");
const { daysElapsedInFY } = require("../forecast");
const { overnightDaysForEntry, entryInFy } = require("../overnight-days");
const { collectPaidLafha, resolveAnnualSalary } = require("../lafha");
const { findOccupation, showsOvernightTravel } = require("./occupations");

/** Employee truck driver Table 5 meals (TD para 12 — Tables 1–3 do not apply). */
const TRUCK_TABLE_5 = {
  "2024-25": { determination: "TD 2024/3", breakfast: 30.15, lunch: 34.55, dinner: 59.6 },
  "2025-26": { determination: "TD 2025/4", breakfast: 31.15, lunch: 35.55, dinner: 61.3 },
  "2026-27": { determination: "TD 2026/4", breakfast: 32.25, lunch: 36.8, dinner: 63.45 },
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function startYear(fy) {
  return Number(String(fy || "").split("-")[0]) || 0;
}

function packDaily(accommodation, breakfast, lunch, dinner, incidentals) {
  const mealsDaily = round2(breakfast + lunch + dinner);
  const mealsAndIncidentals = round2(mealsDaily + incidentals);
  const dailyTotal = round2(accommodation + mealsDaily + incidentals);
  return {
    accommodation,
    breakfast,
    lunch,
    dinner,
    incidentals,
    mealsDaily,
    mealsAndIncidentals,
    dailyTotal,
  };
}

/**
 * Official Tables 1–3, Melbourne as the representative capital city.
 * Salary bands match the same Determination.
 */
const WORK_TRAVEL_SETS = {
  // TD 2022/10 — 2022–23 (also reused for earlier years in the FY window).
  td2022_10: {
    determination: "TD 2022/10",
    incomeYear: "2022-23",
    overtimeMealCap: 33.25,
    representativePlace: "Melbourne",
    tableNote:
      "Tables 1–3 capital-city / high-cost meal amounts (Melbourne accommodation). These tables do not apply to employee truck drivers.",
    salaryBands: [
      { id: "band1", label: "Up to $133,450", maxSalary: 133450 },
      { id: "band2", label: "$133,451 – $237,520", maxSalary: 237520 },
      { id: "band3", label: "$237,521 or more", maxSalary: Infinity },
    ],
    bands: {
      band1: packDaily(173, 29.9, 33.65, 57.3, 21.3),
      band2: packDaily(228, 32.55, 46.0, 64.5, 30.5),
      band3: packDaily(265, 38.2, 54.05, 75.65, 30.5),
    },
  },
  // TD 2023/3 — 2023–24.
  td2023_3: {
    determination: "TD 2023/3",
    incomeYear: "2023-24",
    overtimeMealCap: 35.65,
    representativePlace: "Melbourne",
    tableNote:
      "Tables 1–3 capital-city / high-cost meal amounts (Melbourne accommodation). These tables do not apply to employee truck drivers.",
    salaryBands: [
      { id: "band1", label: "Up to $138,790", maxSalary: 138790 },
      { id: "band2", label: "$138,791 – $247,020", maxSalary: 247020 },
      { id: "band3", label: "$247,021 or more", maxSalary: Infinity },
    ],
    bands: {
      band1: packDaily(173, 32.1, 36.1, 61.5, 23.0),
      band2: packDaily(231, 34.95, 49.35, 69.2, 32.9),
      band3: packDaily(265, 38.9, 55.0, 77.0, 32.9),
    },
  },
  // TD 2024/3 — 2024–25.
  td2024_3: {
    determination: "TD 2024/3",
    incomeYear: "2024-25",
    overtimeMealCap: 37.65,
    representativePlace: "Melbourne",
    tableNote:
      "Tables 1–3 capital-city / high-cost meal amounts (Melbourne accommodation). These tables do not apply to employee truck drivers.",
    salaryBands: [
      { id: "band1", label: "Up to $143,650", maxSalary: 143650 },
      { id: "band2", label: "$143,651 – $255,670", maxSalary: 255670 },
      { id: "band3", label: "$255,671 or more", maxSalary: Infinity },
    ],
    bands: {
      band1: packDaily(173, 33.9, 38.1, 64.95, 23.95),
      band2: packDaily(231, 36.9, 52.1, 73.1, 34.25),
      band3: packDaily(265, 41.1, 58.1, 81.3, 34.25),
    },
  },
  // TD 2025/4 — 2025–26.
  td2025_4: {
    determination: "TD 2025/4",
    incomeYear: "2025-26",
    overtimeMealCap: 38.65,
    representativePlace: "Melbourne",
    tableNote:
      "Tables 1–3 capital-city / high-cost meal amounts (Melbourne accommodation). Paragraph 12: these amounts do not apply to employee truck drivers (Table 5).",
    salaryBands: [
      { id: "band1", label: "Up to $148,250", maxSalary: 148250 },
      { id: "band2", label: "$148,251 – $263,850", maxSalary: 263850 },
      { id: "band3", label: "$263,851 or more", maxSalary: Infinity },
    ],
    bands: {
      band1: packDaily(173, 34.75, 39.1, 66.65, 24.5),
      band2: packDaily(231, 37.85, 53.45, 75.0, 35.05),
      band3: packDaily(265, 42.15, 59.6, 83.4, 35.05),
    },
  },
  // TD 2026/4 — 2026–27 onwards until the next TD ships.
  td2026_4: {
    determination: "TD 2026/4",
    incomeYear: "2026-27",
    overtimeMealCap: 40,
    representativePlace: "Melbourne",
    tableNote:
      "Tables 1–3 capital-city / high-cost meal amounts (Melbourne accommodation). These tables do not apply to employee truck drivers (Table 5).",
    salaryBands: [
      { id: "band1", label: "Up to $153,210", maxSalary: 153210 },
      { id: "band2", label: "$153,211 – $272,680", maxSalary: 272680 },
      { id: "band3", label: "$272,681 or more", maxSalary: Infinity },
    ],
    bands: {
      band1: packDaily(175, 36.0, 40.45, 69.0, 25.4),
      band2: packDaily(233, 39.2, 55.35, 77.65, 36.3),
      band3: packDaily(265, 43.65, 61.7, 86.35, 36.3),
    },
  },
};

/** FBT LAFHA weekly food amounts (ordinary employees living away from home). */
const LAFHA_SETS = {
  td2024_2: {
    determination: "TD 2024/2",
    fbtYearLabel: "FBT year commencing 1 April 2024",
    oneAdult: 331,
    twoAdults: 497,
    statutoryFood: 42,
  },
  td2025_2: {
    determination: "TD 2025/2",
    fbtYearLabel: "FBT year commencing 1 April 2025",
    oneAdult: 341,
    twoAdults: 512,
    statutoryFood: 42,
  },
  td2026_2: {
    determination: "TD 2026/2",
    fbtYearLabel: "FBT year commencing 1 April 2026",
    oneAdult: 353,
    twoAdults: 530,
    statutoryFood: 42,
  },
};

function workTravelSetForYear(fy) {
  const y = startYear(fy);
  if (y >= 2026) return WORK_TRAVEL_SETS.td2026_4;
  if (y >= 2025) return WORK_TRAVEL_SETS.td2025_4;
  if (y >= 2024) return WORK_TRAVEL_SETS.td2024_3;
  if (y >= 2023) return WORK_TRAVEL_SETS.td2023_3;
  return WORK_TRAVEL_SETS.td2022_10;
}

function lafhaSetForYear(fy) {
  const y = startYear(fy);
  if (y >= 2026) return LAFHA_SETS.td2026_2;
  if (y >= 2025) return LAFHA_SETS.td2025_2;
  return LAFHA_SETS.td2024_2;
}

function salaryBandId(annualSalary, set) {
  const amount = Number(annualSalary) || 0;
  const bands = set.salaryBands;
  if (amount <= bands[0].maxSalary) return "band1";
  if (amount <= bands[1].maxSalary) return "band2";
  return "band3";
}

function bandLabel(bandId, set) {
  const meta = (set.salaryBands || []).find((b) => b.id === bandId);
  return meta ? meta.label : bandId;
}

function truckMealsForYear(fy) {
  const year = fy || getCurrentFinancialYear();
  return TRUCK_TABLE_5[year] || (startYear(year) >= 2026 ? TRUCK_TABLE_5["2026-27"] : TRUCK_TABLE_5["2025-26"]);
}

function occupationMeta(profile = {}) {
  return findOccupation(profile.occupationId || profile.occupation);
}

function mealCapsForYear(fy, annualSalary, profile = {}) {
  const year = fy || getCurrentFinancialYear();
  const set = workTravelSetForYear(year);
  const band = salaryBandId(annualSalary, set);
  const daily = set.bands[band] || set.bands.band1;
  const lafha = lafhaWeeklyForYear(year);
  const occ = occupationMeta(profile);
  const travelKind = (occ && occ.travelKind) || "tables_1_3";
  const truck = travelKind === "truck_driver" ? truckMealsForYear(year) : null;
  return {
    determination: truck ? truck.determination : set.determination,
    incomeYear: set.incomeYear,
    overtimeMealCap: set.overtimeMealCap,
    salaryBand: band,
    salaryBandLabel: bandLabel(band, set),
    representativePlace: truck ? "all domestic destinations" : set.representativePlace,
    tableNote: truck
      ? "Table 5 employee truck driver meals. Tables 1–3 do not apply."
      : set.tableNote,
    travelKind: truck ? "truck_driver" : "ordinary_employee",
    occupationTravelKind: travelKind,
    occupation: occ
      ? { id: occ.id, name: occ.name, parent: occ.parent, group: occ.group, travelLabel: occ.travelLabel, travelHint: occ.travelHint }
      : null,
    domesticTravelDaily: {
      accommodation: truck ? 0 : daily.accommodation,
      breakfast: truck ? truck.breakfast : daily.breakfast,
      lunch: truck ? truck.lunch : daily.lunch,
      dinner: truck ? truck.dinner : daily.dinner,
      incidentals: truck ? 0 : daily.incidentals,
    },
    breakfast: truck ? truck.breakfast : daily.breakfast,
    lunch: truck ? truck.lunch : daily.lunch,
    dinner: truck ? truck.dinner : daily.dinner,
    mealsDaily: truck ? round2(truck.breakfast + truck.lunch + truck.dinner) : daily.mealsDaily,
    mealsAndIncidentals: truck
      ? round2(truck.breakfast + truck.lunch + truck.dinner)
      : daily.mealsAndIncidentals,
    dailyTravelTotal: truck
      ? round2(truck.breakfast + truck.lunch + truck.dinner)
      : daily.dailyTotal,
    accommodation: truck ? 0 : daily.accommodation,
    incidentals: truck ? 0 : daily.incidentals,
    lafhaWeekly: lafha,
  };
}

function lafhaWeeklyForYear(fy) {
  const year = fy || getCurrentFinancialYear();
  const set = lafhaSetForYear(year);
  const unsubstantiatedExempt = round2(set.oneAdult - set.statutoryFood);
  return {
    determination: set.determination,
    fbtYearLabel: set.fbtYearLabel,
    oneAdult: set.oneAdult,
    twoAdults: set.twoAdults,
    statutoryFood: set.statutoryFood,
    unsubstantiatedExempt,
  };
}

function workTravelMealLabels(meals) {
  return {
    breakfast: { cap: meals.breakfast, label: "Breakfast (work travel)", substantiation: "reasonable_amount" },
    lunch: { cap: meals.lunch, label: "Lunch (work travel)", substantiation: "reasonable_amount" },
    dinner: { cap: meals.dinner, label: "Dinner (work travel)", substantiation: "reasonable_amount" },
  };
}

function resolveFy(financialYear, profile = {}) {
  return financialYear || profile.financialYear || getCurrentFinancialYear();
}

/**
 * Work travel nights vs FY length. Divisor is Tables 1–3 meals + incidentals
 * (employer often pays the hotel separately — TR 2004/6 / TD Example 2 pattern),
 * never the truck-driver Table 5 meal total.
 */
function summariseOvernightDays(records = {}, profile = {}, financialYear) {
  const fy = resolveFy(financialYear, profile);
  const enabled = showsOvernightTravel(profile);
  if (!enabled) {
    return {
      product: "gotax",
      enabled: false,
      title: "Work-related claims",
      financialYear: fy,
      occupation: occupationMeta(profile),
    };
  }
  const meals = mealCapsForYear(fy, Number(profile.annualSalary) || 0, profile);
  const ratePerDay = meals.mealsAndIncidentals;
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
  const percentOfFyClaimed = daysInFy > 0 ? round2((daysClaimed / daysInFy) * 100) : 0;
  const yearProgress = daysInFy > 0 ? daysElapsed / daysInFy : 0;
  const projectedYearEndDays =
    yearProgress > 0 ? Math.round(daysClaimed / yearProgress) : daysClaimed;
  const place = meals.representativePlace;
  const lafha = meals.lafhaWeekly;

  const occ = meals.occupation;
  const kind = meals.occupationTravelKind || "tables_1_3";
  const title =
    kind === "truck_driver"
      ? "Work travel nights (truck driver)"
      : kind === "airline_crew"
        ? "Crew rest-break nights"
        : kind === "fifo"
          ? "Temporary work-travel nights"
          : kind === "lafha"
            ? "Living-away nights"
            : "Work travel nights";
  const rateLabel =
    kind === "truck_driver"
      ? "Table 5 meals (all destinations)"
      : `meals + incidentals (${place})`;
  const occNote = occ && occ.travelHint ? ` ${occ.travelHint}` : "";
  const occLine = occ ? ` Occupation: ${occ.parent ? `${occ.parent} · ${occ.name}` : occ.name}.` : "";

  return {
    product: "gotax",
    enabled: true,
    travelKind: meals.travelKind,
    occupationTravelKind: kind,
    occupation: occ,
    title,
    financialYear: fy,
    determination: meals.determination,
    salaryBand: meals.salaryBand,
    salaryBandLabel: meals.salaryBandLabel,
    representativePlace: place,
    ratePerDay: round2(ratePerDay),
    rateLabel,
    mealsDaily: meals.mealsDaily,
    incidentals: meals.incidentals,
    dailyTravelTotal: meals.dailyTravelTotal,
    daysClaimed,
    daysInFy,
    daysElapsed,
    daysRemainingInFy,
    percentOfFyClaimed,
    projectedYearEndDays,
    amountPaid,
    entryCount: entries.length,
    entries,
    editButtonLabel: "Edit nights",
    emptyHint:
      kind === "truck_driver"
        ? "Scan payslips that list a travel allowance — nights from the hours/days counter, otherwise amount ÷ Table 5 meals. Accommodation always needs receipts."
        : "Scan payslips that list a travel allowance — nights from the hours/days counter when present, otherwise estimated from travel $ ÷ the ATO reasonable meals + incidentals amount.",
    note:
      (kind === "truck_driver"
        ? `${meals.determination} Table 5 meals $${meals.mealsDaily.toFixed(2)}/day (breakfast/lunch/dinner separate; all domestic destinations). Tables 1–3 do not apply.`
        : `${meals.determination} Tables 1–3 (${place}, ${meals.salaryBandLabel}): ` +
          `reasonable overnight work travel is meals $${meals.mealsDaily.toFixed(2)} + incidentals $${meals.incidentals.toFixed(2)} ` +
          `($${ratePerDay.toFixed(2)}/day used to estimate nights) plus accommodation $${meals.accommodation.toFixed(2)} ` +
          `= $${meals.dailyTravelTotal.toFixed(2)}/day.`) +
      ` Living-away-from-home is a separate FBT food component (${lafha.determination}: $${lafha.oneAdult}/week for one adult).` +
      occLine +
      occNote +
      " Confirm with your payslips and tax adviser.",
  };
}

function incomeInFy(income = [], fy) {
  return (income || []).filter((row) => {
    if (!row || !row.date) return false;
    try {
      return getFinancialYearForDate(row.date) === fy;
    } catch {
      return false;
    }
  });
}

/**
 * FBT LAFHA snapshot for ordinary employees (not truck-driver daily meals).
 */
function summariseLafha(profile = {}, income = [], financialYear) {
  const fy = resolveFy(financialYear, profile);
  const fyIncome = incomeInFy(income, fy);
  const salary = resolveAnnualSalary(profile, fyIncome);
  const caps = mealCapsForYear(fy, salary.amount || Number(profile.annualSalary) || 0, profile);
  const weekly = caps.lafhaWeekly;
  const paid = collectPaidLafha(fyIncome);

  return {
    product: "gotax",
    enabled: showsOvernightTravel(profile),
    travelKind: caps.travelKind,
    occupationTravelKind: caps.occupationTravelKind,
    occupation: caps.occupation,
    driverType: profile.entityType || profile.driverType || "employee",
    financialYear: fy,
    determination: weekly.determination,
    travelDetermination: caps.determination,
    incomeYear: caps.incomeYear,
    fbtYearLabel: weekly.fbtYearLabel,
    salary,
    salaryBand: caps.salaryBand,
    salaryBandLabel: caps.salaryBandLabel,
    representativePlace: caps.representativePlace,
    reasonablePerWeek: weekly.oneAdult,
    reasonablePerDay: null,
    statutoryFoodPerWeek: weekly.statutoryFood,
    unsubstantiatedExemptPerWeek: weekly.unsubstantiatedExempt,
    twoAdultsPerWeek: weekly.twoAdults,
    workTravelDaily: {
      meals: caps.mealsDaily,
      incidentals: caps.incidentals,
      accommodation: caps.accommodation,
      dailyTotal: caps.dailyTravelTotal,
    },
    overtimeMealCap: caps.overtimeMealCap,
    paid,
    note:
      `${weekly.determination} (${weekly.fbtYearLabel}) — reasonable food and drink for a living-away-from-home ` +
      `allowance fringe benefit: $${weekly.oneAdult}/week for one adult within Australia (statutory food $${weekly.statutoryFood}/week; ` +
      `unsubstantiated exempt food component $${weekly.unsubstantiatedExempt}/week). This FBT table applies to occupations ` +
      `such as sales and marketing that live away from home for a period; it is not the employee truck driver meal table. ` +
      `Overnight work travel (hotel nights) uses ${caps.determination} Tables 1–3 instead ` +
      `(${caps.representativePlace} capital city daily total $${caps.dailyTravelTotal.toFixed(2)}).`,
  };
}

module.exports = {
  mealCapsForYear,
  lafhaWeeklyForYear,
  workTravelMealLabels,
  workTravelSetForYear,
  summariseOvernightDays,
  summariseLafha,
  WORK_TRAVEL_SETS,
  LAFHA_SETS,
};
