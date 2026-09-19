const path = require("path");
const fs = require("fs");
const {
  cacheKey,
  parseCacheKey,
  productOf,
  isSuiteRequest,
  isStandaloneSuite,
  publicHomePath,
  recoveryPagePath,
  PRODUCT_COOKIE,
} = require("./product");
const profile = require("./profile");
const {
  presentEntityTypes,
  listEntityDefaults,
  getEntityDefaults,
  searchOccupations,
  findOccupation,
  showsOvernightTravel,
  ensureProfile,
  applySuiteProfile,
  normalizeEntityType,
} = require("./profile");
const { searchEmployers, listEmployers } = require("./employers");
const { listOccupations, listOccupationGroups } = require("./occupations");
const { buildWorkSnapshot } = require("./work-snapshot");
const {
  getCurrentFinancialYear,
  getCategoryMeta,
  getFinancialYearForDate,
} = require("./ato");
const {
  listMenuCategories,
  listMenuCategoryGroups,
  listSpecialClaimCategories,
  listMenuIncomeTypes,
  normalizeExpenseCategoryId,
  normalizeIncomeTypeId,
} = require("./menus");
const {
  summariseYear,
  buildAccountantReport,
  decorateAccountantReport,
  calcExpenseDeduction,
} = require("./tax");
const { buildForecast } = require("./forecast");
const { analyzeScan } = require("./breakdown");
const travel = require("./travel");

function summariseOvernightDays(records, profile, financialYear) {
  const summary = travel.summariseOvernightDays(records, profile, financialYear);
  if (summary && summary.enabled === false) {
    summary.replacement = buildWorkSnapshot(records, profile, financialYear || summary.financialYear);
  }
  return summary;
}

const SUITE_DATA_DIR = path.join(__dirname, "..", "..", "data", "suite");
const SUITE_USERS_DIR = path.join(SUITE_DATA_DIR, "users");

function recordsFileFor(username) {
  const safe = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_");
  fs.mkdirSync(SUITE_USERS_DIR, { recursive: true });
  return path.join(SUITE_USERS_DIR, `${safe}.json`);
}

function emptyGuestRecords() {
  return profile.emptyGuestRecords(getCurrentFinancialYear());
}

function standards(entityType) {
  const entity = normalizeEntityType(entityType);
  return {
    product: "gotax",
    entityType: entity,
    categories: listMenuCategories(entity),
    specialClaimCategories: listSpecialClaimCategories(),
    categoryGroups: listMenuCategoryGroups(entity),
    incomeTypes: listMenuIncomeTypes(entity),
    driverTypes: presentEntityTypes(),
    licenceClasses: [],
    workCombinations: [],
    driverRoleDefaults: listEntityDefaults(),
    financialYear: getCurrentFinancialYear(),
  };
}

module.exports = {
  PRODUCT_COOKIE,
  SUITE_DATA_DIR,
  SUITE_USERS_DIR,
  productOf,
  isSuiteRequest,
  isStandaloneSuite,
  publicHomePath,
  recoveryPagePath,
  cacheKey,
  parseCacheKey,
  recordsFileFor,
  emptyGuestRecords,
  ensureProfile,
  applySuiteProfile,
  normalizeEntityType,
  presentEntityTypes,
  listEntityDefaults,
  getEntityDefaults,
  searchOccupations,
  findOccupation,
  showsOvernightTravel,
  searchEmployers,
  listEmployers,
  listOccupations,
  listOccupationGroups,
  buildWorkSnapshot,
  standards,
  getCategoryMeta,
  getFinancialYearForDate,
  getCurrentFinancialYear,
  listMenuCategories,
  listMenuCategoryGroups,
  listSpecialClaimCategories,
  listMenuIncomeTypes,
  normalizeExpenseCategoryId,
  normalizeIncomeTypeId,
  summariseYear,
  buildAccountantReport,
  decorateAccountantReport,
  calcExpenseDeduction,
  buildForecast,
  analyzeScan,
  summariseOvernightDays,
  summariseLafha: travel.summariseLafha,
  mealCapsForYear: travel.mealCapsForYear,
  lafhaWeeklyForYear: travel.lafhaWeeklyForYear,
};
