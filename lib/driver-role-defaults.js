/**
 * Accepted market defaults for profile annual salary + licence class by
 * driver type. Salary floors align with lib/licence-class.js so the class
 * select updates consistently when an employer suggestion is accepted.
 *
 * Figures are indicative AU industry mid-range guides (not awards).
 */

const { getLicenceClassForSalary, getLicenceClassMeta } = require("./licence-class");
const { DRIVER_TYPES } = require("./ato-standards");

/** @type {Record<string, { annualSalary: number, notes: string }>} */
const DRIVER_ROLE_DEFAULTS = {
  local: {
    annualSalary: 72000,
    notes: "Local / metro distribution — typically LR/MR–HR pay bands.",
  },
  short_haul: {
    annualSalary: 88000,
    notes: "Short-haul / regional — typically HR–HC pay bands.",
  },
  long_haul: {
    annualSalary: 120000,
    notes: "Long-haul / interstate linehaul — typically HC–MC pay bands.",
  },
  owner_driver: {
    annualSalary: 130000,
    notes: "Owner-driver / contractor guide (gross equivalent) — often HC–MC.",
  },
};

function listDriverRoleDefaults() {
  return Object.keys(DRIVER_ROLE_DEFAULTS).map((id) => {
    const row = DRIVER_ROLE_DEFAULTS[id];
    const meta = DRIVER_TYPES[id] || {};
    const licenceClass = getLicenceClassForSalary(row.annualSalary);
    const licence = getLicenceClassMeta(licenceClass);
    return {
      id,
      label: meta.label || id,
      description: meta.description || "",
      annualSalary: row.annualSalary,
      licenceClass,
      licenceLabel: licence ? licence.shortLabel : licenceClass,
      typicalRange: licence ? licence.typicalRange : null,
      notes: row.notes,
    };
  });
}

/**
 * Resolve salary + licence defaults for a driver type id.
 * @returns {{ driverType: string, annualSalary: number, licenceClass: string, label: string, notes: string } | null}
 */
function getDriverRoleDefaults(driverType) {
  const key = String(driverType || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const row = DRIVER_ROLE_DEFAULTS[key];
  if (!row) return null;
  const meta = DRIVER_TYPES[key] || {};
  const licenceClass = getLicenceClassForSalary(row.annualSalary);
  return {
    driverType: key,
    label: meta.label || key,
    description: meta.description || "",
    annualSalary: row.annualSalary,
    licenceClass,
    notes: row.notes,
  };
}

module.exports = {
  DRIVER_ROLE_DEFAULTS,
  listDriverRoleDefaults,
  getDriverRoleDefaults,
};
