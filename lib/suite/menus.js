/**
 * Expense / income dropdowns for Go Taxation Suite.
 * Filters categories by taxpayer registration (employee / sole trader / partnership).
 */

const {
  CATEGORY_GROUPS,
  listCategories,
  listIncomeTypes,
  getCategoryMeta,
  EXPENSE_CATEGORIES,
} = require("./ato");
const { normalizeEntityType } = require("./profile");

const CAR_CLAIM_CATEGORY_IDS = [
  "vehicle_car",
  "fuel",
  "repairs_maintenance",
  "tyres",
  "registration_insurance",
  "parking_tolls",
];

const CAR_CLAIM_GROUP = "Car expenses (ATO work-related)";

const CAR_CLAIM_LABEL_OVERRIDES = {
  vehicle_car: "Car — cents per km or logbook (ATO D1)",
  fuel: "Fuel (work car — logbook / actual)",
  repairs_maintenance: "Repairs & servicing (work car)",
  tyres: "Tyres & wheel services (work car)",
  registration_insurance: "Registration & insurance (work portion)",
  parking_tolls: "Parking, tolls & road charges (work)",
};

const HIDDEN_FROM_GENERAL_MENU = new Set(CAR_CLAIM_CATEGORY_IDS);

function listMenuCategories(entityType) {
  const entity = normalizeEntityType(entityType);
  return listCategories(entity)
    .filter((c) => !HIDDEN_FROM_GENERAL_MENU.has(c.id))
    .map((c) => ({ ...c }));
}

function listMenuCategoryGroups(entityType) {
  const used = new Set(listMenuCategories(entityType).map((c) => c.group));
  return CATEGORY_GROUPS.filter((g) => used.has(g));
}

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

function listMenuIncomeTypes(entityType) {
  const entity = normalizeEntityType(entityType);
  return listIncomeTypes(entity);
}

function normalizeExpenseCategoryId(categoryId) {
  return categoryId;
}

function normalizeIncomeTypeId(typeId, entityType) {
  if (!typeId) return typeId;
  const allowed = new Set(listMenuIncomeTypes(entityType).map((t) => t.id));
  if (allowed.has(typeId)) return typeId;
  const entity = normalizeEntityType(entityType);
  if (entity === "sole_trader") return "business_income";
  if (entity === "partnership") return "partnership_distribution";
  return "salary_wages";
}

module.exports = {
  CAR_CLAIM_CATEGORY_IDS,
  CAR_CLAIM_GROUP,
  CAR_CLAIM_LABEL_OVERRIDES,
  listMenuCategories,
  listMenuCategoryGroups,
  listSpecialClaimCategories,
  listMenuIncomeTypes,
  normalizeExpenseCategoryId,
  normalizeIncomeTypeId,
};
