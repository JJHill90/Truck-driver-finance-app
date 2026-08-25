/**
 * Shared Driver Hub identity for Taxation Hub, Fuel Hub, and later apps.
 *
 * One login (`data/users.json`) + one records file (`data/users/<name>.json`)
 * already holds the Taxation Hub profile. Apps do not copy accounts — they
 * read this presenter. Profile driver type + work vehicle (combination) drive
 * Fuel Hub diesel L/100 km on planned runs. Tanks/load stay on
 * `records.fuelhub` until the driver saves a Fuel Hub override.
 */

const {
  getLicenceClassForSalary,
  getLicenceClassMeta,
  normalizeLicenceClassId,
} = require("./licence-class");
const { driverTypeLabel } = require("./driver-role-defaults");
const { normalizeTruck, normalizeDriverType, DRIVER_TYPE_FACTOR } = require("./fuel-efficiency");
const { COMBINATIONS, getCombination } = require("./fuel-nhvr");
const {
  normalizeFuelVehicles,
  presentFuelVehicle,
  applyClassToTruck,
  listFuelClasses,
} = require("./fuel-vehicle-class");

const LICENCE_TO_COMBINATION = {
  lr_mr: "rigid",
  hr: "rigid",
  hc: "semi",
  mc: "b_double",
};

function combinationFromLicence(licenceClass, driverType) {
  const licence = normalizeLicenceClassId(licenceClass) || "hc";
  const duty = normalizeDriverType(driverType);
  let combinationId = LICENCE_TO_COMBINATION[licence] || "semi";
  // Linehaul / owner-driver HC is commonly a B-double; local/short-haul HC stays a semi.
  if (licence === "hc" && (duty === "long_haul" || duty === "owner_driver")) {
    combinationId = "b_double";
  }
  if (licence === "mc" && duty === "local") combinationId = "semi";
  if (licence === "lr_mr" || licence === "hr") combinationId = "rigid";
  return combinationId;
}

function normalizeWorkCombination(id) {
  if (id == null || id === "") return null;
  const key = String(id)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "truck" || key === "car" || key === "vehicle") return null;
  return COMBINATIONS.some((c) => c.id === key) ? key : null;
}

function listWorkCombinations() {
  return COMBINATIONS.map((c) => ({
    id: c.id,
    label: c.label,
    licence: c.licence,
    typicalTankL: c.typicalTankL,
    baseLPer100: c.baseLPer100,
    notes: c.notes,
  }));
}

function resolveWorkCombination(profile = {}) {
  const saved = normalizeWorkCombination(profile.workCombination || profile.vehicleType);
  if (saved && saved !== "truck") return saved;
  return combinationFromLicence(profile.licenceClass, profile.driverType);
}

function truckDefaultsFromHubProfile(hub) {
  const combinationId =
    (hub && hub.workCombination) || combinationFromLicence(hub && hub.licenceClass, hub && hub.driverType);
  const base = normalizeTruck({
    combinationId,
    driverType: hub && hub.driverType,
  });
  return applyClassToTruck(base, hub && hub.activeFuelVehicle);
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
  const driverType = normalizeDriverType(profile.driverType || "long_haul");
  const username = account && account.username ? account.username : null;
  const name = String(profile.name || "").trim();
  const cars = Array.isArray(profile.cars) ? profile.cars : [];
  const suggestedCombinationId = combinationFromLicence(licenceClass, driverType);
  const workCombination = resolveWorkCombination({
    ...profile,
    licenceClass,
    driverType,
  });
  const combo = getCombination(workCombination);
  const presentOpts = { combinationId: workCombination, driverType };
  const fuelVehicles = normalizeFuelVehicles(profile.fuelVehicles).map((v) =>
    presentFuelVehicle(v, presentOpts)
  );
  const activeVehicle = fuelVehicles.find((v) => v.active) || null;
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
    dutyCycleFactor: DRIVER_TYPE_FACTOR[driverType] || 1,
    licenceClass,
    licenceLabel: licence ? licence.shortLabel : licenceClass,
    annualSalary: salary,
    financialYear: profile.financialYear || "",
    workCombination,
    workCombinationLabel: combo ? combo.label : workCombination,
    suggestedCombinationId,
    vehicleType: profile.vehicleType || "truck",
    tfnSupplied: Boolean(profile.tfnSupplied),
    plan: (account && (account.displayPlan || account.plan)) || "free",
    isPro: Boolean(account && account.isPro),
    workCarCount: cars.length,
    fuelVehicles,
    activeFuelVehicle: activeVehicle,
    fuelClassCatalog: listFuelClasses(),
    apps: ["taxationhub", "fuelhub"],
  };
}

function seedTruckFromHubProfile(store, hub) {
  if (!store || store.truckSavedAt || store.truckSource === "user") {
    if (store && store.truck && hub && hub.activeFuelVehicle) {
      store.truck = applyClassToTruck(store.truck, hub.activeFuelVehicle, { preferTruckFuel: true });
    }
    return { seeded: false, truck: store && store.truck };
  }
  const truck = truckDefaultsFromHubProfile(hub);
  store.truck = truck;
  store.truckSource = "hub_profile";
  return { seeded: true, truck };
}

function applyProfileVehicleFields(body, existingProfile = {}) {
  const next = { ...(body || {}) };
  const driverType = normalizeDriverType(next.driverType || existingProfile.driverType);
  if (next.driverType) next.driverType = driverType;
  const licenceClass = next.licenceClass || existingProfile.licenceClass;
  if (next.workCombination != null && next.workCombination !== "") {
    next.workCombination =
      normalizeWorkCombination(next.workCombination) || combinationFromLicence(licenceClass, driverType);
  } else if (!existingProfile.workCombination) {
    next.workCombination = combinationFromLicence(licenceClass, driverType);
  }
  return next;
}

module.exports = {
  LICENCE_TO_COMBINATION,
  combinationFromLicence,
  normalizeDriverType,
  normalizeWorkCombination,
  listWorkCombinations,
  listFuelClasses,
  resolveWorkCombination,
  truckDefaultsFromHubProfile,
  presentHubProfile,
  seedTruckFromHubProfile,
  applyProfileVehicleFields,
};
