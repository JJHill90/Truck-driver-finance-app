/**
 * Fuel-use model for Fuel Hub.
 *
 * Operating mass includes payload AND diesel in the tanks (fuel has weight).
 * Extra trailers, remote/west running and a heavier GCM all lift L/100 km.
 * Figures are planning estimates for Australian heavy vehicles — not a
 * manufacturer fuel map.
 */

const { dieselKg, DIESEL_KG_PER_L } = require("./fuel-prices");
const { getCombination, getMassScheme, normalizeCombinationId, normalizeMassSchemeId } = require("./fuel-nhvr");

const TERRAIN_FACTOR = {
  metro: 1.08,
  regional: 1,
  remote: 1.06,
  outback_west: 1.14,
};

/** Duty-cycle on top of combination — local stop-start vs linehaul highway. */
const DRIVER_TYPE_FACTOR = {
  local: 1.16,
  short_haul: 1.08,
  long_haul: 1,
  owner_driver: 1.04,
};

function normalizeDriverType(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "linehaul" || key === "line_haul" || key === "interstate") return "long_haul";
  if (DRIVER_TYPE_FACTOR[key] != null) return key;
  return "long_haul";
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTruck(raw = {}) {
  const combinationId = normalizeCombinationId(raw.combinationId || raw.combination);
  const combo = getCombination(combinationId);
  const massSchemeId = normalizeMassSchemeId(raw.massSchemeId || raw.massScheme);
  const scheme = getMassScheme(massSchemeId);
  const trailers = Math.max(0, Math.round(num(raw.trailers, combo.defaultTrailers)));
  const gcmProvided = raw.gcmT != null && raw.gcmT !== "";
  const gcmT = Math.max(
    4,
    num(raw.gcmT, combo.typicalGcmT) * (gcmProvided ? 1 : scheme.massFactor)
  );
  const tareT = Math.max(2, num(raw.tareT, combo.typicalGcmT * 0.42));
  const payloadT = Math.max(
    0,
    num(raw.payloadT, num(raw.loadT, Math.max(0, gcmT - tareT) * 0.75))
  );
  const tankCapacityL = Math.max(
    80,
    num(
      raw.tankCapacityL != null && raw.tankCapacityL !== "" ? raw.tankCapacityL : raw.capacityL,
      combo.typicalTankL
    )
  );
  const currentFuelL = clamp(num(raw.currentFuelL, tankCapacityL * 0.55), 0, tankCapacityL);
  const lengthM = num(raw.lengthM, combo.typicalLengthM);
  const heightM = num(raw.heightM, 4.3);
  const reservePercent = clamp(num(raw.reservePercent, 12), 5, 30);
  const driverType = normalizeDriverType(raw.driverType);
  return {
    combinationId,
    combinationLabel: combo.label,
    massSchemeId,
    trailers,
    gcmT: round1(gcmT),
    tareT: round1(tareT),
    payloadT: round1(payloadT),
    tankCapacityL: round1(tankCapacityL),
    currentFuelL: round1(currentFuelL),
    lengthM: round1(lengthM),
    heightM: round1(heightM),
    reservePercent,
    licence: combo.licence,
    driverType,
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function reserveLitres(truck) {
  const spec = normalizeTruck(truck);
  const pct = spec.tankCapacityL * (spec.reservePercent / 100);
  return round1(Math.max(80, pct));
}

function operatingMassT(truck, fuelL) {
  const spec = normalizeTruck(truck);
  const litres = fuelL == null ? spec.currentFuelL : num(fuelL, spec.currentFuelL);
  const fuelT = dieselKg(litres) / 1000;
  const mass = spec.tareT + spec.payloadT + fuelT;
  return round1(Math.min(spec.gcmT, mass));
}

/**
 * L/100 km from combination, trailers, mass (incl. fuel weight), region and
 * driver type (linehaul highway vs local stop-start).
 */
function consumptionLPer100km(truck, { band = "regional", fuelL, driverType } = {}) {
  const spec = normalizeTruck(truck);
  const combo = getCombination(spec.combinationId);
  const extraTrailers = Math.max(0, spec.trailers - combo.defaultTrailers);
  const trailerLift = extraTrailers * 7.5;
  const mass = operatingMassT(spec, fuelL);
  const massRatio = clamp(mass / Math.max(spec.gcmT, 1), 0.35, 1.05);
  // Lighter running (~empty) ~0.78 of nameplate; at GCM ~1.0; slight overload 1.03.
  const massFactor = 0.78 + 0.22 * massRatio;
  const terrain = TERRAIN_FACTOR[band] || TERRAIN_FACTOR.regional;
  const duty = DRIVER_TYPE_FACTOR[normalizeDriverType(driverType || spec.driverType)] || 1;
  const litres = (combo.baseLPer100 + trailerLift) * massFactor * terrain * duty;
  return round2(litres);
}

function rangeKm(truck, { band = "regional", fuelL } = {}) {
  const spec = normalizeTruck(truck);
  const litres = fuelL == null ? spec.currentFuelL : num(fuelL, spec.currentFuelL);
  const usable = Math.max(0, litres - reserveLitres(spec));
  const cons = consumptionLPer100km(spec, { band, fuelL: litres });
  if (cons <= 0) return 0;
  return round1((usable / cons) * 100);
}

function litresForDistance(km, truck, { band = "regional", fuelL } = {}) {
  const cons = consumptionLPer100km(truck, { band, fuelL });
  return round1((num(km) * cons) / 100);
}

function litresPerKm(truck, opts) {
  return round2(consumptionLPer100km(truck, opts) / 100);
}

function describeEfficiency(truck, { band = "regional", driverType } = {}) {
  const spec = normalizeTruck({ ...truck, driverType: driverType || truck.driverType });
  const fuelKg = dieselKg(spec.currentFuelL);
  const cons = consumptionLPer100km(spec, { band, driverType: spec.driverType });
  const km = rangeKm(spec, { band });
  return {
    truck: spec,
    band,
    dieselKgPerLitre: DIESEL_KG_PER_L,
    fuelMassKg: fuelKg,
    operatingMassT: operatingMassT(spec),
    consumptionLPer100km: cons,
    litresPerKm: round2(cons / 100),
    kmPerLitre: cons > 0 ? round2(100 / cons) : 0,
    reserveL: reserveLitres(spec),
    usableL: round1(Math.max(0, spec.currentFuelL - reserveLitres(spec))),
    rangeKm: km,
    notes: [
      `Fuel in tanks is ~${fuelKg} kg at ${DIESEL_KG_PER_L} kg/L — it counts toward operating mass.`,
      `${spec.trailers} trailer(s) on a ${spec.combinationLabel} · ${spec.driverType.replace(/_/g, " ")} duty cycle.`,
      `${band} running at ${cons} L/100 km gives about ${km} km before reserve.`,
    ],
  };
}

module.exports = {
  TERRAIN_FACTOR,
  DRIVER_TYPE_FACTOR,
  normalizeDriverType,
  normalizeTruck,
  reserveLitres,
  operatingMassT,
  consumptionLPer100km,
  rangeKm,
  litresForDistance,
  litresPerKm,
  describeEfficiency,
};
