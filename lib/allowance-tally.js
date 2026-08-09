/**
 * Daily overnight / travel allowance tallies (ATO TD 2025/4 stack).
 * Band-1 example: meals $128 + overtime meal $38.65 + accommodation $138
 * + incidentals $24.25 = $328.90 per day.
 *
 * Pure helpers used by the dashboard Allowance caps panel.
 */

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

/** Segment definitions from summary.allowances (salary-band aware). */
function buildSegments(allowances = {}) {
  const meals = allowances.truckDriverMealsDaily || {};
  const travel = allowances.domesticTravelCaps || {};
  const breakfast = num(meals.breakfast && meals.breakfast.cap);
  const lunch = num(meals.lunch && meals.lunch.cap);
  const dinner = num(meals.dinner && meals.dinner.cap);
  const mealsCombined = round2(breakfast + lunch + dinner);
  const overtime = num(allowances.overtimeMealCap);
  const accommodation = num(travel.accommodation);
  const incidentals = num(travel.incidentals);

  return [
    {
      id: "breakfast",
      label: "Breakfast",
      group: "meals",
      cap: breakfast,
      spendIds: ["meals_breakfast"],
    },
    {
      id: "lunch",
      label: "Lunch",
      group: "meals",
      cap: lunch,
      spendIds: ["meals_lunch"],
    },
    {
      id: "dinner",
      label: "Dinner",
      group: "meals",
      cap: dinner,
      spendIds: ["meals_dinner"],
    },
    {
      id: "meals_combined",
      label: "Food/meals (Daily)",
      group: "meals",
      // Same ATO meal pot as B+L+D — not added again into the daily total.
      cap: mealsCombined,
      spendIds: ["meals"],
      sharesMealPool: true,
    },
    {
      id: "overtime_meals",
      label: "Overtime meal",
      group: "other",
      cap: overtime,
      spendIds: ["overtime_meals"],
    },
    {
      id: "accommodation",
      label: "Accommodation",
      group: "other",
      cap: accommodation,
      spendIds: ["accommodation"],
    },
    {
      id: "incidentals",
      label: "Incidentals",
      group: "other",
      cap: incidentals,
      spendIds: ["incidentals"],
    },
  ];
}

/** Daily grand-total allowance (meals once + OT + accom + incidentals). */
function dailyAllowanceTotal(allowances = {}) {
  const segments = buildSegments(allowances);
  const mealsCap = segments.find((s) => s.id === "meals_combined")?.cap || 0;
  const other = segments
    .filter((s) => s.group === "other")
    .reduce((sum, s) => sum + num(s.cap), 0);
  return round2(mealsCap + other);
}

function spendForIds(expenses, spendIds, dateIso) {
  const ids = new Set(spendIds);
  return round2(
    (expenses || [])
      .filter(
        (e) =>
          ids.has(e.category) && String(e.date || "").slice(0, 10) === dateIso
      )
      .reduce((sum, e) => sum + num(e.amount), 0)
  );
}

/**
 * Tally one calendar day (ISO YYYY-MM-DD).
 * @returns {{
 *   date: string,
 *   dailyAllow: number,
 *   spend: number,
 *   remaining: number,
 *   over: boolean,
 *   mealPoolCap: number,
 *   mealPoolSpend: number,
 *   segments: Array<object>
 * }}
 */
function tallyDay(expenses, allowances, dateIso) {
  const segments = buildSegments(allowances);
  const dailyAllow = dailyAllowanceTotal(allowances);
  const mealPoolCap = segments.find((s) => s.id === "meals_combined")?.cap || 0;

  const rows = segments.map((seg) => {
    const spend = spendForIds(expenses, seg.spendIds, dateIso);
    const remaining = round2(seg.cap - spend);
    return {
      id: seg.id,
      label: seg.label,
      group: seg.group,
      sharesMealPool: Boolean(seg.sharesMealPool),
      cap: seg.cap,
      spend,
      remaining,
      over: spend > seg.cap && seg.cap > 0,
    };
  });

  const mealPoolSpend = round2(
    rows.filter((r) => r.group === "meals").reduce((s, r) => s + r.spend, 0)
  );
  const spend = round2(rows.reduce((s, r) => s + r.spend, 0));
  const remaining = round2(dailyAllow - spend);

  return {
    date: dateIso,
    dailyAllow,
    spend,
    remaining,
    over: spend > dailyAllow,
    mealPoolCap,
    mealPoolSpend,
    mealPoolOver: mealPoolSpend > mealPoolCap && mealPoolCap > 0,
    segments: rows,
  };
}

/**
 * Sum tallies across days; include per-day breakdown.
 * @param {string[]} dates ISO dates inclusive
 */
function tallyPeriod(expenses, allowances, dates) {
  const days = (dates || []).map((d) => tallyDay(expenses, allowances, d));
  const dailyAllow = days[0] ? days[0].dailyAllow : dailyAllowanceTotal(allowances);
  const periodAllow = round2(dailyAllow * days.length);
  const spend = round2(days.reduce((s, d) => s + d.spend, 0));
  const remaining = round2(periodAllow - spend);

  // Aggregate segment spend across the period (caps stay daily; show period spend).
  const segmentMap = new Map();
  for (const day of days) {
    for (const seg of day.segments) {
      const prev = segmentMap.get(seg.id) || {
        id: seg.id,
        label: seg.label,
        group: seg.group,
        sharesMealPool: seg.sharesMealPool,
        dailyCap: seg.cap,
        spend: 0,
      };
      prev.spend = round2(prev.spend + seg.spend);
      segmentMap.set(seg.id, prev);
    }
  }

  return {
    dates,
    dayCount: days.length,
    dailyAllow,
    periodAllow,
    spend,
    remaining,
    over: spend > periodAllow,
    segments: [...segmentMap.values()],
    days,
  };
}

/** Inclusive list of ISO dates from start..end (YYYY-MM-DD). */
function eachIsoDate(startIso, endIso) {
  const out = [];
  if (!startIso || !endIso) return out;
  const [ys, ms, ds] = startIso.split("-").map(Number);
  const [ye, me, de] = endIso.split("-").map(Number);
  const cur = new Date(Date.UTC(ys, ms - 1, ds));
  const end = new Date(Date.UTC(ye, me - 1, de));
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function monthBounds(yearMonth) {
  const [y, m] = String(yearMonth || "")
    .split("-")
    .map(Number);
  if (!y || !m) return null;
  const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

module.exports = {
  buildSegments,
  dailyAllowanceTotal,
  tallyDay,
  tallyPeriod,
  eachIsoDate,
  monthBounds,
  spendForIds,
};
