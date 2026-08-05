const {
  dailyAllowanceTotal,
  tallyDay,
  tallyPeriod,
  eachIsoDate,
  monthBounds,
  buildSegments,
} = require("./lib/allowance-tally");

const band1Allowances = {
  truckDriverMealsDaily: {
    breakfast: { cap: 31.15 },
    lunch: { cap: 35.55 },
    dinner: { cap: 61.3 },
  },
  overtimeMealCap: 38.65,
  domesticTravelCaps: {
    accommodation: 138,
    incidentals: 24.25,
  },
};

describe("dailyAllowanceTotal", () => {
  it("matches band-1 ATO stack $328.90", () => {
    expect(dailyAllowanceTotal(band1Allowances)).toBe(328.9);
  });
});

describe("tallyDay", () => {
  it("tallies breakfast, lunch, dinner and accommodation separately", () => {
    const expenses = [
      { date: "2026-08-04", category: "meals_breakfast", amount: 20 },
      { date: "2026-08-04", category: "meals_lunch", amount: 30 },
      { date: "2026-08-04", category: "meals_dinner", amount: 50 },
      { date: "2026-08-04", category: "accommodation", amount: 100 },
      { date: "2026-08-03", category: "meals_breakfast", amount: 99 },
    ];
    const day = tallyDay(expenses, band1Allowances, "2026-08-04");
    expect(day.dailyAllow).toBe(328.9);
    expect(day.spend).toBe(200);
    expect(day.remaining).toBe(128.9);
    const byId = Object.fromEntries(day.segments.map((s) => [s.id, s]));
    expect(byId.breakfast.spend).toBe(20);
    expect(byId.lunch.spend).toBe(30);
    expect(byId.dinner.spend).toBe(50);
    expect(byId.accommodation.spend).toBe(100);
    expect(byId.meals_combined.spend).toBe(0);
    expect(day.mealPoolSpend).toBe(100);
  });

  it("counts combined food/meals against the meal pool", () => {
    const expenses = [{ date: "2026-08-04", category: "meals", amount: 80 }];
    const day = tallyDay(expenses, band1Allowances, "2026-08-04");
    const meals = day.segments.find((s) => s.id === "meals_combined");
    expect(meals.spend).toBe(80);
    expect(day.mealPoolSpend).toBe(80);
    expect(day.spend).toBe(80);
  });
});

describe("tallyPeriod", () => {
  it("sums days and keeps a per-day breakdown", () => {
    const expenses = [
      { date: "2026-08-03", category: "meals_breakfast", amount: 10 },
      { date: "2026-08-04", category: "accommodation", amount: 50 },
    ];
    const period = tallyPeriod(expenses, band1Allowances, ["2026-08-03", "2026-08-04"]);
    expect(period.dayCount).toBe(2);
    expect(period.periodAllow).toBe(657.8);
    expect(period.spend).toBe(60);
    expect(period.days).toHaveLength(2);
    expect(period.days[0].spend).toBe(10);
    expect(period.days[1].spend).toBe(50);
  });
});

describe("date helpers", () => {
  it("lists inclusive ISO dates", () => {
    expect(eachIsoDate("2026-08-01", "2026-08-03")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("monthBounds returns calendar month ends", () => {
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2026-08")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("buildSegments exposes seven rows", () => {
    expect(buildSegments(band1Allowances)).toHaveLength(7);
  });
});
