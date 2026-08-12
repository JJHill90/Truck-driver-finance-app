/**
 * Work-car presets on the driver profile (Car Expenses tab).
 * Stored as profile.cars[] — make, model, registration, engine size,
 * with per-car active/inactive for ATO work-use acknowledgment.
 */
const crypto = require("crypto");

const MAX_CARS = 10;
const FIELD_MAX = 80;

function trimStr(value, max = FIELD_MAX) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function newCarId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
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
  if (!make && !model && !registration && !engineSize) return null;

  const id = trimStr(raw.id, 64) || newCarId();
  const createdAt = raw.createdAt && !Number.isNaN(new Date(raw.createdAt).getTime())
    ? new Date(raw.createdAt).toISOString()
    : now;
  return {
    id,
    make,
    model,
    registration,
    engineSize,
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

module.exports = {
  MAX_CARS,
  FIELD_MAX,
  newCarId,
  normalizeCar,
  normalizeCars,
  formatCarLine,
  compileActiveCarsText,
  activeCars,
};
