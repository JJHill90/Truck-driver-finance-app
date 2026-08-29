/**
 * ATO D1 work-related car trips (cents per kilometre + logbook diary).
 * Stored as records.carTrips[] — layered outside verbatim storage.js.
 *
 * Cents per km: each closed trip is one start→end journey with work km.
 * Logbook: open trips collect destinations; close-out finalises the diary row.
 * Reconcile / soft-delete mirror expense ledger lifecycle fields.
 */
const crypto = require("crypto");
const { toIsoAusDate } = require("./aus-date");
const { CENTS_PER_KM, getFinancialYearForDate } = require("./ato-standards");
const { centsPerKmForYear } = require("./historical-rates");

const METHODS = Object.freeze({
  CENTS: "cents_per_km",
  LOGBOOK: "logbook",
});

const ATO_CENTS_HELP =
  "ATO cents per kilometre (D1): claim the set rate for each work kilometre (up to 5,000 km per car per income year). Record how you worked out the kilometres — start and end destinations support that. You do not need written evidence of each expense, but keep a diary of work trips. Optional receipt photos can still be stored for your records.";

const ATO_LOGBOOK_HELP =
  "ATO logbook method (D1): keep a logbook for a continuous 12-week period that represents your normal pattern of use. For each journey record the date, odometer readings, total kilometres, and the purpose of the journey (including destinations). Use the logbook to work out your business-use percentage, then apply that percentage to actual car expenses for the year (fuel, servicing, insurance, decline in value, and so on). Keep written evidence of those expenses. A valid logbook can usually be relied on for up to five years if your pattern of use does not change substantially.";

function newId() {
  return crypto.randomUUID();
}

function normalizeMethod(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (v === "logbook" || v === "log_book") return METHODS.LOGBOOK;
  return METHODS.CENTS;
}

function ensureCarTrips(records) {
  if (!records.carTrips) records.carTrips = [];
  return records.carTrips;
}

function findTrip(records, id) {
  return ensureCarTrips(records).find((t) => t && t.id === id) || null;
}

function isDeleted(trip) {
  return Boolean(trip && trip.deletedAt);
}

function isReconciled(trip) {
  return Boolean(trip && trip.reconciled && !isDeleted(trip));
}

function assertEditable(trip) {
  if (!trip) return { ok: false, error: "Trip not found.", code: "not_found" };
  if (isDeleted(trip)) return { ok: false, error: "Trip is deleted.", code: "deleted" };
  if (isReconciled(trip)) {
    return {
      ok: false,
      error: "This trip is reconciled and cannot be edited. Ask the primary mod to unlock it first.",
      code: "reconciled",
    };
  }
  return { ok: true };
}

function cleanText(value, max = 200) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function numOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDestinations(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((d) => {
      if (typeof d === "string") return { name: cleanText(d, 120) };
      return {
        name: cleanText(d && d.name, 120),
        odometer: d && d.odometer != null ? cleanText(d.odometer, 40) : "",
        note: d && d.note != null ? cleanText(d.note, 160) : "",
      };
    })
    .filter((d) => d.name);
}

function routeLabel(trip) {
  if (!trip) return "—";
  if (trip.method === METHODS.LOGBOOK) {
    const stops = (trip.destinations || []).map((d) => d.name).filter(Boolean);
    if (trip.origin) stops.unshift(trip.origin);
    if (!stops.length) return "Open logbook trip";
    return stops.join(" → ");
  }
  const a = trip.origin || "—";
  const b = trip.destination || "—";
  return `${a} → ${b}`;
}

/**
 * Create a cents-per-km trip (always closed) or open a logbook trip.
 */
function createTrip(records, payload = {}, { username } = {}) {
  ensureCarTrips(records);
  const method = normalizeMethod(payload.method || payload.carClaimMethod);
  const date = toIsoAusDate(payload.date) || String(payload.date || "").slice(0, 10);
  if (!date) {
    return { ok: false, error: "Enter the trip date.", code: "missing_date", status: 400 };
  }

  const now = new Date().toISOString();
  const trip = {
    id: newId(),
    method,
    date,
    carId: payload.carId || null,
    origin: cleanText(payload.origin, 120),
    destination: cleanText(payload.destination, 120),
    destinations: normalizeDestinations(payload.destinations),
    kilometres: numOrNull(payload.kilometres),
    odometerStart: cleanText(payload.odometerStart, 40),
    odometerEnd: cleanText(payload.odometerEnd, 40),
    purpose: cleanText(payload.purpose || payload.description, 240),
    status: method === METHODS.LOGBOOK ? "open" : "closed",
    closedAt: method === METHODS.LOGBOOK ? null : now,
    expenseId: null,
    reconciled: false,
    reconciledAt: null,
    reconciledBy: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    createdBy: username || null,
  };

  if (method === METHODS.CENTS) {
    if (!trip.origin || !trip.destination) {
      return {
        ok: false,
        error: "Enter starting and ending destinations for a cents-per-kilometre trip.",
        code: "missing_route",
        status: 400,
      };
    }
    if (trip.kilometres == null || trip.kilometres < 0) {
      return {
        ok: false,
        error: "Enter the work kilometres for this trip.",
        code: "missing_km",
        status: 400,
      };
    }
  }

  if (method === METHODS.LOGBOOK && trip.origin) {
    trip.destinations = [
      { name: trip.origin, odometer: trip.odometerStart || "", note: "Start" },
      ...trip.destinations,
    ];
  }

  records.carTrips.unshift(trip);
  return { ok: true, trip };
}

function addDestination(records, id, dest = {}) {
  const trip = findTrip(records, id);
  const gate = assertEditable(trip);
  if (!gate.ok) {
    return { ok: false, ...gate, status: gate.code === "not_found" ? 404 : 409 };
  }
  if (trip.method !== METHODS.LOGBOOK) {
    return {
      ok: false,
      error: "Only logbook trips accept multiple destinations.",
      code: "wrong_method",
      status: 400,
    };
  }
  if (trip.status !== "open") {
    return {
      ok: false,
      error: "This trip is already closed.",
      code: "already_closed",
      status: 409,
    };
  }
  const name = cleanText(dest.name || dest.destination, 120);
  if (!name) {
    return { ok: false, error: "Enter a destination name.", code: "missing_destination", status: 400 };
  }
  trip.destinations = trip.destinations || [];
  trip.destinations.push({
    name,
    odometer: cleanText(dest.odometer, 40),
    note: cleanText(dest.note, 160),
  });
  trip.destination = name;
  trip.updatedAt = new Date().toISOString();
  return { ok: true, trip };
}

function closeTrip(records, id, patch = {}, { username } = {}) {
  const trip = findTrip(records, id);
  const gate = assertEditable(trip);
  if (!gate.ok) {
    return { ok: false, ...gate, status: gate.code === "not_found" ? 404 : 409 };
  }
  if (trip.status === "closed") {
    return { ok: true, trip, alreadyClosed: true };
  }
  if (trip.method !== METHODS.LOGBOOK) {
    return {
      ok: false,
      error: "Only open logbook trips use close-out.",
      code: "wrong_method",
      status: 400,
    };
  }
  const stops = trip.destinations || [];
  if (stops.length < 2) {
    return {
      ok: false,
      error: "Add at least one destination after the start before closing this trip.",
      code: "incomplete_trip",
      status: 400,
    };
  }
  const now = new Date().toISOString();
  if (patch.kilometres != null) trip.kilometres = numOrNull(patch.kilometres);
  if (patch.odometerEnd != null) trip.odometerEnd = cleanText(patch.odometerEnd, 40);
  if (patch.purpose != null) trip.purpose = cleanText(patch.purpose, 240);
  trip.origin = stops[0].name;
  trip.destination = stops[stops.length - 1].name;
  trip.status = "closed";
  trip.closedAt = now;
  trip.closedBy = username || null;
  trip.updatedAt = now;
  return { ok: true, trip };
}

function updateTrip(records, id, patch = {}) {
  const trip = findTrip(records, id);
  const gate = assertEditable(trip);
  if (!gate.ok) {
    return { ok: false, ...gate, status: gate.code === "not_found" ? 404 : 409 };
  }
  if (patch.date !== undefined) {
    trip.date = toIsoAusDate(patch.date) || trip.date;
  }
  if (patch.origin !== undefined) trip.origin = cleanText(patch.origin, 120);
  if (patch.destination !== undefined) trip.destination = cleanText(patch.destination, 120);
  if (patch.destinations !== undefined) trip.destinations = normalizeDestinations(patch.destinations);
  if (patch.kilometres !== undefined) trip.kilometres = numOrNull(patch.kilometres);
  if (patch.odometerStart !== undefined) trip.odometerStart = cleanText(patch.odometerStart, 40);
  if (patch.odometerEnd !== undefined) trip.odometerEnd = cleanText(patch.odometerEnd, 40);
  if (patch.purpose !== undefined) trip.purpose = cleanText(patch.purpose, 240);
  if (patch.carId !== undefined) trip.carId = patch.carId || null;
  trip.updatedAt = new Date().toISOString();
  return { ok: true, trip };
}

function reconcileTrips(records, ids, { username } = {}) {
  const now = new Date().toISOString();
  const by = username ? String(username) : null;
  const updated = [];
  const skipped = [];
  const notFound = [];
  for (const id of [...new Set((ids || []).map(String).filter(Boolean))]) {
    const trip = findTrip(records, id);
    if (!trip) {
      notFound.push(id);
      continue;
    }
    if (isDeleted(trip) || trip.status === "open") {
      skipped.push(id);
      continue;
    }
    trip.reconciled = true;
    trip.reconciledAt = now;
    trip.reconciledBy = by;
    trip.updatedAt = now;
    updated.push(trip);
  }
  return { updated, skipped, notFound };
}

function unreconcileTrips(records, ids, { username } = {}) {
  const now = new Date().toISOString();
  const updated = [];
  const notFound = [];
  for (const id of [...new Set((ids || []).map(String).filter(Boolean))]) {
    const trip = findTrip(records, id);
    if (!trip) {
      notFound.push(id);
      continue;
    }
    trip.reconciled = false;
    trip.reconciledAt = null;
    trip.reconciledBy = null;
    trip.unreconciledAt = now;
    trip.unreconciledBy = username || null;
    trip.updatedAt = now;
    updated.push(trip);
  }
  return { updated, notFound };
}

function softDeleteTrip(records, id, { username, force = false } = {}) {
  const trip = findTrip(records, id);
  if (!trip) return { ok: false, error: "Trip not found.", code: "not_found" };
  if (isDeleted(trip)) return { ok: false, error: "Trip already deleted.", code: "already_deleted" };
  if (isReconciled(trip) && !force) {
    return {
      ok: false,
      error: "This trip is reconciled and cannot be deleted. Ask the primary mod to unlock it first.",
      code: "reconciled",
      trip,
    };
  }
  const now = new Date().toISOString();
  trip.deletedAt = now;
  trip.deletedBy = username || null;
  trip.updatedAt = now;
  return { ok: true, trip };
}

function restoreTrip(records, id, { username } = {}) {
  const trip = findTrip(records, id);
  if (!trip) return { ok: false, error: "Trip not found.", code: "not_found" };
  if (!isDeleted(trip)) return { ok: true, trip, alreadyActive: true };
  const now = new Date().toISOString();
  trip.deletedAt = null;
  trip.deletedBy = null;
  trip.restoredAt = now;
  trip.restoredBy = username || null;
  trip.updatedAt = now;
  return { ok: true, trip };
}

function activeTrips(records) {
  return ensureCarTrips(records).filter((t) => t && !isDeleted(t));
}

function fyWorkKm(records, fy, { method = METHODS.CENTS } = {}) {
  let km = 0;
  for (const t of activeTrips(records)) {
    if (t.method !== method || t.status !== "closed") continue;
    if (getFinancialYearForDate(t.date) !== fy) continue;
    km += Number(t.kilometres) || 0;
  }
  return Math.round(km * 100) / 100;
}

function centsClaimPreview(records, fy) {
  const km = fyWorkKm(records, fy, { method: METHODS.CENTS });
  const capped = Math.min(km, CENTS_PER_KM.maxKm || 5000);
  const rate = centsPerKmForYear(fy);
  return {
    financialYear: fy,
    kilometres: km,
    claimableKilometres: capped,
    overCap: km > (CENTS_PER_KM.maxKm || 5000),
    ratePerKm: rate,
    estimatedDeduction: Math.round(capped * rate * 100) / 100,
    maxKm: CENTS_PER_KM.maxKm || 5000,
  };
}

/**
 * Sync a closed cents-per-km trip into the expenses ledger so tax/summary
 * keep using the existing D1 calculator.
 */
function syncCentsTripExpense(records, trip, { storageAddExpense, storageUpdate } = {}) {
  if (!trip || trip.method !== METHODS.CENTS || trip.status !== "closed" || isDeleted(trip)) {
    return null;
  }
  const fy = getFinancialYearForDate(trip.date);
  const rate = centsPerKmForYear(fy);
  const km = Number(trip.kilometres) || 0;
  const amount = Math.round(km * rate * 100) / 100;
  const description = `${routeLabel(trip)}${trip.purpose ? ` — ${trip.purpose}` : ""}`;
  const patch = {
    date: trip.date,
    category: "vehicle_car",
    method: "cents_per_km",
    kilometres: km,
    amount,
    description,
    vendor: "Work car trip",
    workUsePercent: 100,
    reimbursed: false,
    notes: `carTrip:${trip.id}`,
  };

  if (trip.expenseId) {
    const existing = (records.expenses || []).find((e) => e && e.id === trip.expenseId);
    if (existing && storageUpdate) {
      storageUpdate(records, trip.expenseId, patch);
      return existing;
    }
  }
  if (!storageAddExpense) return null;
  const entry = storageAddExpense(records, { ...patch, receiptId: null });
  trip.expenseId = entry.id;
  return entry;
}

function softDeleteLinkedExpense(records, trip, { softDeleteEntry, username } = {}) {
  if (!trip || !trip.expenseId || !softDeleteEntry) return;
  softDeleteEntry(records, "expense", trip.expenseId, { username, force: true });
}

module.exports = {
  METHODS,
  ATO_CENTS_HELP,
  ATO_LOGBOOK_HELP,
  normalizeMethod,
  ensureCarTrips,
  findTrip,
  assertEditable,
  isDeleted,
  isReconciled,
  routeLabel,
  createTrip,
  addDestination,
  closeTrip,
  updateTrip,
  reconcileTrips,
  unreconcileTrips,
  softDeleteTrip,
  restoreTrip,
  activeTrips,
  fyWorkKm,
  centsClaimPreview,
  syncCentsTripExpense,
  softDeleteLinkedExpense,
};
