/**
 * Hub overnight meal check against the truck-driver reasonable amounts in config.
 * TD 2026/4 Table 5 amounts cannot be transferred between meals.
 */
const { travelRatesForYear } = require("./historical-rates");

const MEAL_KEYS = {
  meals_breakfast: "breakfast",
  meals_lunch: "lunch",
  meals_dinner: "dinner",
  meals: "dinner",
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function assessOvernightMeal({ category, amount, financialYear } = {}) {
  const key = MEAL_KEYS[String(category || "")];
  if (!key) return null;
  const rates = travelRatesForYear(financialYear);
  const meal = rates.truckDriverMeals && rates.truckDriverMeals[key];
  if (!meal) return null;
  const cap = round2(meal.cap);
  const spent = round2(amount);
  return {
    determination: rates.determination,
    meal: key,
    label: meal.label,
    cap,
    amount: spent,
    within: spent <= cap,
    note: `${rates.determination} ${meal.label} reasonable amount is $${cap.toFixed(2)}. This receipt is $${spent.toFixed(2)} — ${spent <= cap ? "within" : "over"} the allowance.`,
  };
}

module.exports = {
  MEAL_KEYS,
  assessOvernightMeal,
};
