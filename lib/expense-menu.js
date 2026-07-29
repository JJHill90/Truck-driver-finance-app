/**
 * Expense category menu for dropdowns: hide unused entries, rename labels, and
 * expose a single consolidated "Food/Meals" category (no breakfast/lunch/dinner).
 * Keeps lib/ato-standards.js verbatim; registers `meals` for tax/OCR lookups.
 */
const {
  EXPENSE_CATEGORIES,
  listCategories,
  TRUCK_DRIVER_MEALS,
} = require("./ato-standards");

function round2(n) {
  return Math.round(n * 100) / 100;
}

const HIDDEN_FROM_MENU = new Set([
  "snacks_drinks",
  "meals_breakfast",
  "meals_lunch",
  "meals_dinner",
  "adblue_fluids",
  "truck_cabin_equipment",
  // Truck running / maintenance (drivers shouldn't pick these in the UI)
  "vehicle_truck",
  "fuel",
  "repairs_maintenance",
  "tyres",
  "parking_tolls",
  "weighbridge",
  "load_restraint",
]);

/** Display labels that differ from the ATO-standards source labels. */
const LABEL_OVERRIDES = {
  cleaning_supplies: "Truck cleaning (truck washing)",
  office_admin: "Logbook/Work Diary/EWD (Purchase and subscription)",
  compulsory_assessment: "Medical equipment",
};

/** Legacy meal category ids that map onto the consolidated meals claim. */
const LEGACY_MEAL_IDS = new Set(["meals_breakfast", "meals_lunch", "meals_dinner"]);

const COMBINED_MEALS_CAP = round2(
  (Number(TRUCK_DRIVER_MEALS.breakfast.cap) || 0) +
    (Number(TRUCK_DRIVER_MEALS.lunch.cap) || 0) +
    (Number(TRUCK_DRIVER_MEALS.dinner.cap) || 0)
);

const MEALS_META = {
  label: "Food/Meals",
  group: "Meals (ATO reasonable amounts)",
  atoSchedule: "D5 – Travel",
  method: "reasonable_or_actual",
  substantiation: "reasonable_amount",
  cap: COMBINED_MEALS_CAP,
  notes: "Combined food/meals claim (no breakfast/lunch/dinner split). Cap is the sum of ATO reasonable daily amounts.",
};

/** Ensure tax calculator / OCR can resolve category id `meals`. */
function ensureMealsRegistered() {
  EXPENSE_CATEGORIES.meals = { ...MEALS_META };
}

function applyMenuPresentation(cat) {
  const override = LABEL_OVERRIDES[cat.id];
  return override ? { ...cat, label: override } : cat;
}

function listMenuCategories() {
  ensureMealsRegistered();
  const cats = listCategories()
    .filter((c) => !HIDDEN_FROM_MENU.has(c.id) && c.id !== "meals")
    .map(applyMenuPresentation);
  const overtimeIdx = cats.findIndex((c) => c.id === "overtime_meals");
  const entry = { id: "meals", ...MEALS_META };
  if (overtimeIdx >= 0) cats.splice(overtimeIdx, 0, entry);
  else {
    const mealsGroupIdx = cats.findIndex((c) => c.group === MEALS_META.group);
    if (mealsGroupIdx >= 0) cats.splice(mealsGroupIdx, 0, entry);
    else cats.push(entry);
  }
  return cats;
}

/** Map OCR / legacy meal suggestions onto the consolidated menu id. */
function normalizeExpenseCategoryId(categoryId) {
  if (!categoryId) return categoryId;
  if (LEGACY_MEAL_IDS.has(categoryId)) return "meals";
  return categoryId;
}

function isMealSpendCategory(categoryId) {
  return categoryId === "meals" || LEGACY_MEAL_IDS.has(categoryId);
}

module.exports = {
  HIDDEN_FROM_MENU,
  LABEL_OVERRIDES,
  LEGACY_MEAL_IDS,
  COMBINED_MEALS_CAP,
  MEALS_META,
  ensureMealsRegistered,
  listMenuCategories,
  normalizeExpenseCategoryId,
  isMealSpendCategory,
};
