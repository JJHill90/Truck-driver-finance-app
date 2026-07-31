/**
 * Australian truck licence-class pay bands for the driver profile.
 * Thresholds follow common market ranges (LR/MR → MC). When ranges overlap,
 * the highest class whose floor the salary meets wins — same rule at each level.
 *
 * Separate from ATO domestic-travel salary bands (band1/2/3 in ato-standards).
 */

const LICENCE_CLASSES = [
  {
    id: "lr_mr",
    label: "LR/MR — Light/Medium Rigid",
    shortLabel: "LR/MR",
    minSalary: 0,
    typicalRange: "$58,000 – $75,000",
    notes: "Local couriers, small box trucks, light distribution.",
  },
  {
    id: "hr",
    label: "HR — Heavy Rigid",
    shortLabel: "HR",
    minSalary: 70000,
    typicalRange: "$70,000 – $88,000",
    notes: "Local general freight, bus operations, waste management.",
  },
  {
    id: "hc",
    label: "HC — Heavy Combination",
    shortLabel: "HC",
    minSalary: 79000,
    typicalRange: "$79,000 – $110,000",
    notes: "Semi-trailers and B-doubles on regional or local linehaul.",
  },
  {
    id: "mc",
    label: "MC — Multi-Combination",
    shortLabel: "MC",
    minSalary: 110000,
    typicalRange: "$110,000 – $160,000+",
    notes: "Heavy B-doubles, road trains, interstate linehaul.",
  },
];

const LICENCE_CLASS_IDS = new Set(LICENCE_CLASSES.map((c) => c.id));

function listLicenceClasses() {
  return LICENCE_CLASSES.map((c) => ({ ...c }));
}

function getLicenceClassMeta(id) {
  return LICENCE_CLASSES.find((c) => c.id === id) || null;
}

/**
 * Pick licence class from annual salary in dollars.
 * Progressive floors: MC (≥110k) → HC (≥79k) → HR (≥70k) → LR/MR.
 */
function getLicenceClassForSalary(annualSalary) {
  const n = Number(annualSalary);
  const salary = Number.isFinite(n) && n > 0 ? n : 0;
  // Walk from highest class down so overlapping market ranges resolve cleanly.
  for (let i = LICENCE_CLASSES.length - 1; i >= 0; i -= 1) {
    if (salary >= LICENCE_CLASSES[i].minSalary) return LICENCE_CLASSES[i].id;
  }
  return "lr_mr";
}

function normalizeLicenceClassId(id) {
  if (!id) return null;
  const key = String(id).trim().toLowerCase().replace(/\s+/g, "_");
  if (LICENCE_CLASS_IDS.has(key)) return key;
  // Legacy / friendly aliases
  if (key === "lr" || key === "mr" || key === "lrmr" || key === "light_rigid" || key === "medium_rigid") {
    return "lr_mr";
  }
  if (key === "heavy_rigid") return "hr";
  if (key === "heavy_combination" || key === "semi") return "hc";
  if (key === "multi_combination" || key === "road_train") return "mc";
  return null;
}

module.exports = {
  LICENCE_CLASSES,
  listLicenceClasses,
  getLicenceClassMeta,
  getLicenceClassForSalary,
  normalizeLicenceClassId,
};
