/**
 * Shared Driver Hub identity for Taxation Hub, Fuel Hub, and later apps.
 *
 * One login (`data/users.json`) + one records file (`data/users/<name>.json`)
 * already holds the Taxation Hub profile. Apps do not copy accounts — they
 * read this presenter. Fuel-specific tanks/load stay on `records.fuelhub`
 * and are only seeded from licence class until the driver saves them.
 */

const {
  getLicenceClassForSalary,
  getLicenceClassMeta,
  normalizeLicenceClassId,
} = require("./licence-class");
const { driverTypeLabel } = require("./driver-role-defaults");
const { normalizeTruck } = require("./fuel-efficiency");

const LICENCE_TO_COMBINATION = {
  lr_mr: "rigid",
  hr: "rigid",
  hc: "semi",
  mc: "b_double",
};

function combinationFromLicence(licenceClass, driverType) {
  const licence = normalizeLicenceClassId(licenceClass) || "hc";
  let combinationId = LICENCE_TO_COMBINATION[licence] || "semi";
  // Linehaul HC is commonly a B-double; local/short-haul HC stays a semi.
  if (licence === "hc" && (driverType === "long_haul" || driverType === "owner_driver")) {
    combinationId = "b_double";
  }
  if (licence === "mc" && driverType === "local") combinationId = "semi";
  return combinationId;
}

function truckDefaultsFromHubProfile(hub) {
  const combinationId = combinationFromLicence(hub && hub.licenceClass, hub && hub.driverType);
  return normalizeTruck({ combinationId });
}

/**
 * Safe, app-agnostic snapshot of the signed-in driver.
 * `account` is auth.publicUser / getUser; `records` is the per-user JSON.
 */
function presentHubProfile(account, records) {
  const profile = (records && records.profile) || {};
  const salary = Number(profile.annualSalary) || 0;
  const licenceClass =
    normalizeLicenceClassId(profile.licenceClass) || getLicenceClassForSalary(salary) || "hc";
  const licence = getLicenceClassMeta(licenceClass);
  const driverType = profile.driverType || "long_haul";
  const username = account && account.username ? account.username : null;
  const name = String(profile.name || "").trim();
  const cars = Array.isArray(profile.cars) ? profile.cars : [];
  return {
    username,
    linked: Boolean(username),
    displayName: name || username || "Driver",
    name,
    email: (account && account.email) || "",
    employer: String(profile.employer || "").trim(),
    abn: String(profile.abn || "").trim(),
    driverType,
    driverTypeLabel: driverTypeLabel(driverType),
    licenceClass,
    licenceLabel: licence ? licence.shortLabel : licenceClass,
    annualSalary: salary,
    financialYear: profile.financialYear || "",
    vehicleType: profile.vehicleType || "truck",
    tfnSupplied: Boolean(profile.tfnSupplied),
    plan: (account && (account.displayPlan || account.plan)) || "free",
    isPro: Boolean(account && account.isPro),
    suggestedCombinationId: combinationFromLicence(licenceClass, driverType),
    workCarCount: cars.length,
    apps: ["taxationhub", "fuelhub"],
  };
}

function seedTruckFromHubProfile(store, hub) {
  if (!store || store.truckSavedAt) {
    return { seeded: false, truck: store && store.truck };
  }
  const truck = truckDefaultsFromHubProfile(hub);
  store.truck = truck;
  store.truckSource = "hub_profile";
  return { seeded: true, truck };
}

module.exports = {
  LICENCE_TO_COMBINATION,
  combinationFromLicence,
  truckDefaultsFromHubProfile,
  presentHubProfile,
  seedTruckFromHubProfile,
};
