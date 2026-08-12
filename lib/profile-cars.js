/**
 * Work-car presets on the driver profile (Car Expenses tab).
 * Stored as profile.cars[] — make, model, registration, engine size,
 * speedometer/odometer reading, estimated work-use %, with per-car
 * active/inactive for ATO work-use acknowledgment.
 */
const crypto = require("crypto");

const MAX_CARS = 10;
const FIELD_MAX = 80;

/**
 * ATO D1 logbook worked example from public instructions:
 * 4,100 work-related km ÷ 6,500 total km ≈ 63%.
 * Taxation statistics publish average claim *dollars*, not a national
 * work-use percentage — so this is the ATO’s public illustrative figure.
 */
const ATO_D1_EXAMPLE_WORK_USE_PERCENT = 63;
const ATO_D1_EXAMPLE_SOURCE =
  "ATO D1 Work-related car expenses — logbook method worked example";
const ATO_D1_EXAMPLE_NOTE =
  "ATO public D1 guidance uses a worked example of about 63% work use (4,100 work km ÷ 6,500 total km). Set your own estimate from a logbook or reasonable records — home to your usual depot is generally private.";

function trimStr(value, max = FIELD_MAX) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function newCarId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function clampWorkUsePercent(value, fallback = ATO_D1_EXAMPLE_WORK_USE_PERCENT) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Normalize one car object. Returns null if nothing usable was provided.
 */
function normalizeCar(raw, { now = new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const make = trimStr(raw.make);
  const model = trimStr(raw.model);
  const registration = trimStr(raw.registration, 20).toUpperCase();
  const engineSize = trimStr(raw.engineSize, 40);
  const odometerReading = trimStr(
    raw.odometerReading != null ? raw.odometerReading : raw.speedometerReading,
    40
  );
  if (!make && !model && !registration && !engineSize && !odometerReading) return null;

  const id = trimStr(raw.id, 64) || newCarId();
  const createdAt =
    raw.createdAt && !Number.isNaN(new Date(raw.createdAt).getTime())
      ? new Date(raw.createdAt).toISOString()
      : now;
  const hasWorkUse =
    raw.estimatedWorkUsePercent != null && raw.estimatedWorkUsePercent !== "";
  return {
    id,
    make,
    model,
    registration,
    engineSize,
    odometerReading,
    estimatedWorkUsePercent: clampWorkUsePercent(
      hasWorkUse ? raw.estimatedWorkUsePercent : ATO_D1_EXAMPLE_WORK_USE_PERCENT
    ),
    active: Boolean(raw.active),
    createdAt,
    updatedAt: now,
  };
}

/**
 * Normalize a cars array for profile storage.
 * Caps at MAX_CARS; drops empty rows; preserves first occurrence of each id.
 */
function normalizeCars(input, { now = new Date().toISOString() } = {}) {
  if (input == null) return [];
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (out.length >= MAX_CARS) break;
    const car = normalizeCar(raw, { now });
    if (!car) continue;
    if (seen.has(car.id)) continue;
    seen.add(car.id);
    out.push(car);
  }
  return out;
}

function formatCarLine(car) {
  if (!car) return "";
  const bits = [];
  if (car.make || car.model) bits.push([car.make, car.model].filter(Boolean).join(" "));
  if (car.registration) bits.push(`Rego ${car.registration}`);
  if (car.engineSize) bits.push(`Engine ${car.engineSize}`);
  if (car.odometerReading) bits.push(`Odometer ${car.odometerReading}`);
  if (car.estimatedWorkUsePercent != null) {
    bits.push(`Work use ${car.estimatedWorkUsePercent}%`);
  }
  return bits.join(" · ");
}

/** Plain-text block of active cars for ATO / notes copy. */
function compileActiveCarsText(cars) {
  const list = normalizeCars(cars).filter((c) => c.active);
  if (!list.length) {
    return "No active work cars on file. Add a vehicle below and mark it Active for ATO work-use claims.";
  }
  const lines = list.map((c, i) => `${i + 1}. ${formatCarLine(c)}`);
  return ["Active work vehicle(s) for ATO car expense claims:", ...lines].join("\n");
}

function activeCars(cars) {
  return normalizeCars(cars).filter((c) => c.active);
}

/** First active car (profile order) — used as default for claim work-use %. */
function primaryActiveCar(cars) {
  const list = activeCars(cars);
  return list[0] || null;
}

function primaryActiveWorkUsePercent(cars) {
  const car = primaryActiveCar(cars);
  if (!car) return null;
  return clampWorkUsePercent(car.estimatedWorkUsePercent);
}

function atoWorkUseGuidance() {
  return {
    examplePercent: ATO_D1_EXAMPLE_WORK_USE_PERCENT,
    source: ATO_D1_EXAMPLE_SOURCE,
    note: ATO_D1_EXAMPLE_NOTE,
  };
}

module.exports = {
  MAX_CARS,
  FIELD_MAX,
  ATO_D1_EXAMPLE_WORK_USE_PERCENT,
  ATO_D1_EXAMPLE_SOURCE,
  ATO_D1_EXAMPLE_NOTE,
  newCarId,
  clampWorkUsePercent,
  normalizeCar,
  normalizeCars,
  formatCarLine,
  compileActiveCarsText,
  activeCars,
  primaryActiveCar,
  primaryActiveWorkUsePercent,
  atoWorkUseGuidance,
};
