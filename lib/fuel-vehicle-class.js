/**
 * Registered-vehicle fuel-capacity classes on the Driver Hub profile.
 *
 * Work vehicle (rigid / semi / B-double) is a general combination. These codes
 * are a finer, driver-entered class on the individual truck they register —
 * they set diesel carrying capacity and therefore fill spacing on Fuel Hub
 * routes. They are not ATO work cars (`profile.cars`) and not NHVR combination
 * ids. Sample catalog codes (XN93DX, YN16BQ, YN17BQ) sit under a typical
 * heavy rigid; drivers can also type a custom code and tank litres.
 */

const crypto = require("crypto");
const { normalizeTruck, rangeKm } = require("./fuel-efficiency");

const MAX_FUEL_VEHICLES = 8;
const FIELD_MAX = 80;

const FUEL_CLASSES = [
  {
    id: "XN93DX",
    label: "Compact rigid (short range)",
    typicalCombination: "rigid",
    tankCapacityL: 380,
    consumptionFactor: 0.97,
    notes: "Smaller single tank than a generic heavy rigid — more frequent fills on the same corridor.",
  },
  {
    id: "YN16BQ",
    label: "Standard rigid",
    typicalCombination: "rigid",
    tankCapacityL: 520,
    consumptionFactor: 1,
    notes: "Typical heavy-rigid fuel class. Larger than compact, still short of a dual-tank long-range spec.",
  },
  {
    id: "YN17BQ",
    label: "Long-range rigid (dual tank)",
    typicalCombination: "rigid",
    tankCapacityL: 680,
    consumptionFactor: 1.04,
    notes: "Extended / dual-tank heavy rigid — fewer fills, more diesel mass in the tanks.",
  },
];

const CLASS_BY_ID = Object.fromEntries(FUEL_CLASSES.map((c) => [c.id, c]));

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function trimStr(value, max = FIELD_MAX) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeClassCode(raw) {
  const code = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (code.length < 4 || code.length > 12) return "";
  return code;
}

function getFuelClass(code) {
  const id = normalizeClassCode(code);
  return CLASS_BY_ID[id] || null;
}

function listFuelClasses() {
  return FUEL_CLASSES.map((c) => ({ ...c }));
}

function tankForClass(code, overrideL) {
  if (overrideL != null && overrideL !== "") {
    return clamp(Math.round(num(overrideL, 0)), 80, 4000);
  }
  const cls = getFuelClass(code);
  return cls ? cls.tankCapacityL : 400;
}

function consumptionFactorForClass(code, override) {
  if (override != null && override !== "") {
    return clamp(num(override, 1), 0.85, 1.2);
  }
  const cls = getFuelClass(code);
  return cls ? cls.consumptionFactor : 1;
}

function presentClassMeta(code) {
  const id = normalizeClassCode(code);
  const cls = getFuelClass(id);
  if (cls) {
    return {
      id: cls.id,
      label: cls.label,
      typicalCombination: cls.typicalCombination,
      tankCapacityL: cls.tankCapacityL,
      consumptionFactor: cls.consumptionFactor,
      notes: cls.notes,
      catalog: true,
    };
  }
  if (!id) return null;
  return {
    id,
    label: "Custom fuel class",
    typicalCombination: "rigid",
    tankCapacityL: 400,
    consumptionFactor: 1,
    notes: "Driver-entered class — set tank litres on the registered vehicle to match the truck.",
    catalog: false,
  };
}

/**
 * Normalize one registered fuel vehicle. Null if nothing usable was provided.
 */
function normalizeFuelVehicle(raw, { now = new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const classCode = normalizeClassCode(raw.classCode || raw.class || raw.code);
  const registration = trimStr(raw.registration, 20).toUpperCase();
  const nickname = trimStr(raw.nickname || raw.name, 40);
  if (!classCode && !registration && !nickname) return null;
  if (!classCode) return null;

  const meta = presentClassMeta(classCode);
  const tankCapacityL = tankForClass(
    classCode,
    raw.tankCapacityL != null && raw.tankCapacityL !== "" ? raw.tankCapacityL : raw.capacityL
  );
  const currentFuelL = clamp(
    num(
      raw.currentFuelL != null && raw.currentFuelL !== "" ? raw.currentFuelL : tankCapacityL * 0.55,
      tankCapacityL * 0.55
    ),
    0,
    tankCapacityL
  );
  const createdAt =
    raw.createdAt && !Number.isNaN(new Date(raw.createdAt).getTime())
      ? new Date(raw.createdAt).toISOString()
      : now;
  return {
    id: trimStr(raw.id, 64) || newId(),
    registration,
    classCode,
    classLabel: meta ? meta.label : classCode,
    nickname,
    tankCapacityL,
    currentFuelL: Math.round(currentFuelL * 10) / 10,
    consumptionFactor: consumptionFactorForClass(classCode, raw.consumptionFactor),
    catalog: Boolean(meta && meta.catalog),
    notes: meta ? meta.notes : "",
    typicalCombination: meta ? meta.typicalCombination : "rigid",
    active: Boolean(raw.active),
    createdAt,
    updatedAt: now,
  };
}

function normalizeFuelVehicles(input, { now = new Date().toISOString() } = {}) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (out.length >= MAX_FUEL_VEHICLES) break;
    const row = normalizeFuelVehicle(raw, { now });
    if (!row) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  const activeIdx = out.findIndex((v) => v.active);
  return out.map((v, i) => ({ ...v, active: activeIdx >= 0 ? i === activeIdx : false }));
}

function activeFuelVehicle(list) {
  const rows = normalizeFuelVehicles(list);
  return rows.find((v) => v.active) || null;
}

function upsertFuelVehicle(list, raw) {
  const rows = normalizeFuelVehicles(list);
  const next = normalizeFuelVehicle(raw);
  if (!next) {
    const err = new Error("Enter a fuel class code (e.g. XN93DX) for this registered vehicle.");
    err.status = 400;
    throw err;
  }
  const idx = rows.findIndex((v) => v.id === next.id);
  if (idx >= 0) {
    next.createdAt = rows[idx].createdAt || next.createdAt;
    rows[idx] = next;
  } else {
    if (rows.length >= MAX_FUEL_VEHICLES) {
      const err = new Error(`You can save up to ${MAX_FUEL_VEHICLES} registered fuel vehicles.`);
      err.status = 400;
      throw err;
    }
    rows.push(next);
  }
  return normalizeFuelVehicles(rows.map((v) => (next.active ? { ...v, active: v.id === next.id } : v)));
}

function removeFuelVehicle(list, id) {
  return normalizeFuelVehicles((list || []).filter((v) => v.id !== id));
}

function activateFuelVehicle(list, id) {
  const rows = normalizeFuelVehicles(list);
  if (!rows.some((v) => v.id === id)) {
    const err = new Error("Registered fuel vehicle not found.");
    err.status = 404;
    throw err;
  }
  return normalizeFuelVehicles(rows.map((v) => ({ ...v, active: v.id === id })));
}

function formatFuelVehicleLine(vehicle) {
  if (!vehicle) return "";
  const bits = [];
  if (vehicle.nickname) bits.push(vehicle.nickname);
  if (vehicle.registration) bits.push(`Rego ${vehicle.registration}`);
  bits.push(vehicle.classCode);
  if (vehicle.classLabel && vehicle.classLabel !== vehicle.classCode) bits.push(vehicle.classLabel);
  bits.push(`${vehicle.tankCapacityL} L tank`);
  if (vehicle.currentFuelL != null) bits.push(`${vehicle.currentFuelL} L on board`);
  return bits.join(" · ");
}

function compileActiveFuelVehicleText(list) {
  const active = activeFuelVehicle(list);
  if (!active) {
    return "No active registered fuel vehicle. Add a class code (XN93DX, YN16BQ, YN17BQ, or custom) and mark it Active — Fuel Hub uses that tank for fill routes instead of a generic heavy rigid.";
  }
  return `Active registered fuel vehicle: ${formatFuelVehicleLine(active)}`;
}

/**
 * Overlay registered-vehicle class tank / consumption onto a Fuel Hub truck.
 * Combination stays on Profile work vehicle; class only changes carrying
 * capacity (and a small class factor) so routes are not generic rigid.
 */
function applyClassToTruck(truck, vehicle, { preferTruckFuel = false } = {}) {
  if (!vehicle || !vehicle.classCode) {
    const spec = normalizeTruck(truck || {});
    return { ...spec, classCode: null, classConsumptionFactor: 1 };
  }
  const tankCapacityL = tankForClass(vehicle.classCode, vehicle.tankCapacityL);
  let currentFuelL;
  if (preferTruckFuel && truck && truck.currentFuelL != null && truck.currentFuelL !== "") {
    currentFuelL = clamp(num(truck.currentFuelL, tankCapacityL * 0.55), 0, tankCapacityL);
  } else if (vehicle.currentFuelL != null && vehicle.currentFuelL !== "") {
    currentFuelL = clamp(num(vehicle.currentFuelL, tankCapacityL * 0.55), 0, tankCapacityL);
  } else {
    currentFuelL = clamp(num(truck && truck.currentFuelL, tankCapacityL * 0.55), 0, tankCapacityL);
  }
  return normalizeTruck({
    ...(truck || {}),
    tankCapacityL,
    currentFuelL,
    classCode: vehicle.classCode,
    classConsumptionFactor: consumptionFactorForClass(vehicle.classCode, vehicle.consumptionFactor),
  });
}

function describeClassRange(vehicle, { driverType = "long_haul", combinationId = "rigid" } = {}) {
  const truck = applyClassToTruck(
    { combinationId, driverType },
    vehicle
  );
  return {
    classCode: vehicle && vehicle.classCode,
    tankCapacityL: truck.tankCapacityL,
    currentFuelL: truck.currentFuelL,
    rangeKm: rangeKm(truck, { band: "regional" }),
    consumptionFactor: truck.classConsumptionFactor || 1,
  };
}

function presentFuelVehicle(vehicle) {
  if (!vehicle) return null;
  const row = normalizeFuelVehicle(vehicle);
  if (!row) return null;
  const range = describeClassRange(row, { combinationId: row.typicalCombination || "rigid" });
  return { ...row, rangeKm: range.rangeKm };
}

module.exports = {
  MAX_FUEL_VEHICLES,
  FUEL_CLASSES,
  listFuelClasses,
  normalizeClassCode,
  getFuelClass,
  presentClassMeta,
  tankForClass,
  consumptionFactorForClass,
  normalizeFuelVehicle,
  normalizeFuelVehicles,
  activeFuelVehicle,
  upsertFuelVehicle,
  removeFuelVehicle,
  activateFuelVehicle,
  formatFuelVehicleLine,
  compileActiveFuelVehicleText,
  applyClassToTruck,
  describeClassRange,
  presentFuelVehicle,
};
