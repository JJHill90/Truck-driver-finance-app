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
  siblingPublicUrl,
  suiteEntryUrl,
  driverHubEntryUrl,
  productMeta,
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
const extraEntity = require("./extra-entity");
const partnershipSeat = require("./partnership-seat");
const basPack = require("./bas-pack");

function summariseOvernightDays(records, profile, financialYear) {
  const summary = travel.summariseOvernightDays(records, profile, financialYear);
  if (summary && summary.enabled === false) {
    summary.replacement = buildWorkSnapshot(records, profile, financialYear || summary.financialYear);
  }
  return summary;
}

const { getDataDir: resolveDataDir } = require("../data-dir");
let suiteDataOverride = null;

function currentSuiteDir() {
  return suiteDataOverride || path.join(resolveDataDir(), "suite");
}

function setDataDirForTests(dir) {
  suiteDataOverride = dir ? path.join(dir, "suite") : null;
}

function recordsFileFor(username) {
  const safe = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_");
  const usersDir = path.join(currentSuiteDir(), "users");
  fs.mkdirSync(usersDir, { recursive: true });
  return path.join(usersDir, `${safe}.json`);
}

/**
 * Keep a Suite ledger file if it already exists. If a new Suite file would
 * be empty but the shared-login haulage file has data, copy that across so
 * a product split or missing suite/ folder does not look like a wipe.
 */
function seedRecordsIfMissing(username, haulageFile) {
  const dest = recordsFileFor(username);
  if (fs.existsSync(dest)) return dest;
  if (haulageFile && fs.existsSync(haulageFile)) {
    fs.copyFileSync(haulageFile, dest);
  }
  return dest;
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
  get SUITE_DATA_DIR() {
    return currentSuiteDir();
  },
  get SUITE_USERS_DIR() {
    return path.join(currentSuiteDir(), "users");
  },
  setDataDirForTests,
  productOf,
  isSuiteRequest,
  isStandaloneSuite,
  publicHomePath,
  recoveryPagePath,
  siblingPublicUrl,
  suiteEntryUrl,
  driverHubEntryUrl,
  productMeta,
  cacheKey,
  parseCacheKey,
  recordsFileFor,
  seedRecordsIfMissing,
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
  extraEntity,
  partnershipSeat,
  basPack,
  summariseLafha: travel.summariseLafha,
  mealCapsForYear: travel.mealCapsForYear,
  lafhaWeeklyForYear: travel.lafhaWeeklyForYear,
};
