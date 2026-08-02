/**
 * Expense category menu for dropdowns: hide unused entries, rename labels, and
 * expose a single consolidated "Food/Meals" category (no breakfast/lunch/dinner).
 * Keeps lib/ato-standards.js verbatim; registers `meals` for tax/OCR lookups.
 *
 * The Car Expenses/Claims panel uses a separate ATO car-focused list
 * (listSpecialClaimCategories) — cents/km or logbook plus common running costs.
 */
const {
  EXPENSE_CATEGORIES,
  CATEGORY_GROUPS,
  listCategories,
  getCategoryMeta,
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
  // Entire "Vehicle & fuel" group — use Car Expenses/Claims instead
  "vehicle_truck",
  "vehicle_car",
  "fuel",
  "repairs_maintenance",
  "tyres",
  "registration_insurance",
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

/** Move selected categories into a different dropdown group (ato-standards stay verbatim). */
const MEDICAL_GROUP = "Medical";
const GROUP_OVERRIDES = {
  compulsory_assessment: MEDICAL_GROUP,
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
  const next = { ...cat };
  if (LABEL_OVERRIDES[cat.id]) next.label = LABEL_OVERRIDES[cat.id];
  if (GROUP_OVERRIDES[cat.id]) next.group = GROUP_OVERRIDES[cat.id];
  return next;
}

/**
 * Group headers for general expense dropdowns (manual / scan / profile / ledger).
 * Drops "Vehicle & fuel" (car claims live in Car Expenses/Claims) and inserts Medical.
 */
function listMenuCategoryGroups() {
  const groups = CATEGORY_GROUPS.filter((g) => g !== "Vehicle & fuel");
  if (!groups.includes(MEDICAL_GROUP)) {
    const otherIdx = groups.indexOf("Other");
    const profIdx = groups.indexOf("Professional & fees");
    if (profIdx >= 0) groups.splice(profIdx + 1, 0, MEDICAL_GROUP);
    else if (otherIdx >= 0) groups.splice(otherIdx, 0, MEDICAL_GROUP);
    else groups.push(MEDICAL_GROUP);
  }
  return groups;
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

/**
 * ATO work-related car expense categories for the Car Expenses/Claims panel.
 * Covers D1 (cents per km / logbook) plus common logbook running costs and
 * separately claimable parking/tolls. Truck-only costs stay out.
 */
const CAR_CLAIM_CATEGORY_IDS = [
  "vehicle_car",
  "fuel",
  "repairs_maintenance",
  "tyres",
  "registration_insurance",
  "parking_tolls",
];

const CAR_CLAIM_GROUP = "Car expenses (ATO work-related)";

/** Clearer labels in the car-claims dropdown (source ato-standards stay verbatim). */
const CAR_CLAIM_LABEL_OVERRIDES = {
  vehicle_car: "Car — cents per km or logbook (ATO D1)",
  fuel: "Fuel (work car — logbook / actual)",
  repairs_maintenance: "Repairs & servicing (work car)",
  tyres: "Tyres & wheel services (work car)",
  registration_insurance: "Registration & insurance (work portion)",
  parking_tolls: "Parking, tolls & road charges (work)",
};

/**
 * Categories for #expense-category (Car Expenses/Claims). Independent of the
 * general expense/manual menus so laundry and other non-car claims stay elsewhere.
 */
function listSpecialClaimCategories() {
  return CAR_CLAIM_CATEGORY_IDS.map((id) => {
    const meta = getCategoryMeta(id) || EXPENSE_CATEGORIES[id];
    if (!meta) return null;
    return {
      id,
      ...meta,
      group: CAR_CLAIM_GROUP,
      label: CAR_CLAIM_LABEL_OVERRIDES[id] || meta.label,
    };
  }).filter(Boolean);
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
  GROUP_OVERRIDES,
  MEDICAL_GROUP,
  LEGACY_MEAL_IDS,
  COMBINED_MEALS_CAP,
  MEALS_META,
  CAR_CLAIM_CATEGORY_IDS,
  CAR_CLAIM_GROUP,
  CAR_CLAIM_LABEL_OVERRIDES,
  ensureMealsRegistered,
  listMenuCategories,
  listMenuCategoryGroups,
  listSpecialClaimCategories,
  normalizeExpenseCategoryId,
  isMealSpendCategory,
};
