/**
 * Per-user Fuel Hub records: truck spec, fuel cards, observed prices, trips.
 * Stored on the same JSON document as Taxation Hub (`records.fuelhub`).
 */

const crypto = require("crypto");
const { normalizeTruck } = require("./fuel-efficiency");
const { getRetailer, roundCpl } = require("./fuel-prices");
const { trackDistanceKm } = require("./fuel-stations");
const { seedTruckFromHubProfile } = require("./hub-profile");
const { applyClassToTruck } = require("./fuel-vehicle-class");
const { presentContact, presentReceipt } = require("./fuel-receipts");

const MAX_CARDS = 16;
const MAX_TRIPS = 40;
const MAX_OBSERVED = 80;
const MAX_POINTS = 400;

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function trimStr(value, max = 80) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function emptyFuelhub() {
  return {
    truck: normalizeTruck({}),
    truckSource: "default",
    truckSavedAt: null,
    lastPlan: null,
    cards: [],
    observedPrices: [],
    trips: [],
    employerContacts: [],
    fuelReceipts: [],
  };
}

function ensureFuelhub(records, { hubProfile = null } = {}) {
  const created = !records.fuelhub || typeof records.fuelhub !== "object";
  if (created) {
    records.fuelhub = emptyFuelhub();
  }
  if (!Array.isArray(records.fuelhub.cards)) records.fuelhub.cards = [];
  if (!Array.isArray(records.fuelhub.observedPrices)) records.fuelhub.observedPrices = [];
  if (!Array.isArray(records.fuelhub.trips)) records.fuelhub.trips = [];
  if (!Array.isArray(records.fuelhub.employerContacts)) records.fuelhub.employerContacts = [];
  if (!Array.isArray(records.fuelhub.fuelReceipts)) records.fuelhub.fuelReceipts = [];
  if (records.fuelhub.lastPlan == null) records.fuelhub.lastPlan = null;
  if (!records.fuelhub.truck) records.fuelhub.truck = normalizeTruck({});
  if (hubProfile) {
    const store = records.fuelhub;
    const frozen = Boolean(store.truckSavedAt) || store.truckSource === "user";
    if (frozen) {
      // Keep payload / combination the driver saved in Fuel Hub, but always
      // follow Profile driver type so linehaul vs local still scales L/100 km.
      // Registered fuel-class tank still overlays generic combination tanks.
      store.truck = applyClassToTruck(
        normalizeTruck({
          ...store.truck,
          driverType: hubProfile.driverType || store.truck.driverType,
        }),
        hubProfile.activeFuelVehicle,
        { preferTruckFuel: true }
      );
      if (!store.truckSource) store.truckSource = "user";
    } else {
      seedTruckFromHubProfile(store, hubProfile);
    }
  }
  return records.fuelhub;
}

function saveTruck(store, raw, { hubProfile = null } = {}) {
  const posted = normalizeTruck({
    ...(raw || {}),
    driverType: (raw && raw.driverType) || (store.truck && store.truck.driverType),
  });
  store.truck = applyClassToTruck(posted, hubProfile && hubProfile.activeFuelVehicle, {
    preferTruckFuel: true,
  });
  store.truckSavedAt = new Date().toISOString();
  store.truckSource = "user";
  return store.truck;
}

function normalizeCard(raw = {}, { now = new Date().toISOString() } = {}) {
  const name = trimStr(raw.name || raw.label, 80);
  const retailer = getRetailer(raw.retailerId || raw.brand || raw.retailer);
  const retailerId = retailer ? retailer.id : trimStr(raw.retailerId || raw.brand || "any", 40) || "any";
  const cplOff = Math.max(0, Math.min(40, Number(raw.cplOff) || 0));
  const percentOff = Math.max(0, Math.min(25, Number(raw.percentOff) || 0));
  const companyCplOff = Math.max(0, Math.min(20, Number(raw.companyCplOff) || 0));
  if (!name && !cplOff && !percentOff && !companyCplOff) return null;
  return {
    id: trimStr(raw.id, 64) || newId(),
    name: name || `${retailer ? retailer.name : "Fleet"} card`,
    retailerId,
    cplOff,
    percentOff,
    companyWide: Boolean(raw.companyWide) || companyCplOff > 0,
    companyCplOff,
    company: trimStr(raw.company, 80),
    truckOnly: raw.truckOnly !== false,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

function upsertCard(store, raw) {
  const card = normalizeCard(raw);
  if (!card) {
    const err = new Error("Enter a card name or a discount (cents per litre or %).");
    err.status = 400;
    throw err;
  }
  const cards = store.cards || [];
  const idx = cards.findIndex((c) => c.id === card.id);
  if (idx >= 0) {
    card.createdAt = cards[idx].createdAt || card.createdAt;
    cards[idx] = card;
  } else {
    if (cards.length >= MAX_CARDS) {
      const err = new Error("Maximum fuel cards reached.");
      err.status = 400;
      throw err;
    }
    cards.push(card);
  }
  store.cards = cards;
  return card;
}

function removeCard(store, id) {
  const before = (store.cards || []).length;
  store.cards = (store.cards || []).filter((c) => c.id !== id);
  return before !== store.cards.length;
}

function recordObservedPrice(store, raw = {}) {
  const stationId = trimStr(raw.stationId, 64);
  const cpl = roundCpl(raw.cpl);
  if (!stationId || cpl == null || cpl < 80 || cpl > 400) {
    const err = new Error("Observed diesel price needs a station and a cpl between 80 and 400.");
    err.status = 400;
    throw err;
  }
  const row = {
    stationId,
    cpl,
    at: new Date().toISOString(),
    note: trimStr(raw.note, 120),
  };
  store.observedPrices = (store.observedPrices || []).filter((p) => p.stationId !== stationId);
  store.observedPrices.unshift(row);
  store.observedPrices = store.observedPrices.slice(0, MAX_OBSERVED);
  return row;
}

function saveTrip(store, raw = {}) {
  const origin = trimStr(raw.origin, 80);
  const destination = trimStr(raw.destination, 80);
  if (!origin || !destination) {
    const err = new Error("A trip needs an origin and destination.");
    err.status = 400;
    throw err;
  }
  const points = Array.isArray(raw.points) ? raw.points.slice(-MAX_POINTS) : [];
  const gpsKm = points.length >= 2 ? trackDistanceKm(points) : 0;
  const distanceKm = Number(raw.distanceKm) > 0 ? Number(raw.distanceKm) : gpsKm;
  const trip = {
    id: trimStr(raw.id, 64) || newId(),
    origin,
    destination,
    via: Array.isArray(raw.via) ? raw.via.map((v) => trimStr(v, 80)).filter(Boolean).slice(0, 8) : [],
    distanceKm,
    gpsKm,
    mode: raw.mode === "gps" ? "gps" : "offline",
    planSummary: raw.planSummary || null,
    payloadT: Number(raw.payloadT) >= 0 ? Number(raw.payloadT) : null,
    fuelLoadL: Number(raw.fuelLoadL) >= 0 ? Number(raw.fuelLoadL) : null,
    hours: Number(raw.hours) > 0 ? Number(raw.hours) : null,
    litresPerKm: Number(raw.litresPerKm) > 0 ? Number(raw.litresPerKm) : null,
    points,
    createdAt: new Date().toISOString(),
  };
  store.trips = store.trips || [];
  store.trips.unshift(trip);
  store.trips = store.trips.slice(0, MAX_TRIPS);
  return trip;
}

function appendTrack(store, raw = {}) {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng != null ? raw.lng : raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error("GPS point needs lat and lng.");
    err.status = 400;
    throw err;
  }
  if (!store.activeTrack || raw.reset) {
    store.activeTrack = {
      id: newId(),
      startedAt: new Date().toISOString(),
      points: [],
    };
  }
  store.activeTrack.points.push({
    lat,
    lng,
    at: raw.at || new Date().toISOString(),
  });
  if (store.activeTrack.points.length > MAX_POINTS) {
    store.activeTrack.points = store.activeTrack.points.slice(-MAX_POINTS);
  }
  const km = trackDistanceKm(store.activeTrack.points);
  store.activeTrack.km = km;
  store.activeTrack.updatedAt = new Date().toISOString();
  return store.activeTrack;
}

function saveLastPlan(store, plan) {
  store.lastPlan = plan || null;
  return store.lastPlan;
}

function removeTrip(store, id) {
  const before = (store.trips || []).length;
  store.trips = (store.trips || []).filter((t) => t.id !== id);
  return before !== store.trips.length;
}

function removeObservedPrice(store, stationId) {
  const sid = trimStr(stationId, 64);
  const before = (store.observedPrices || []).length;
  store.observedPrices = (store.observedPrices || []).filter((p) => p.stationId !== sid);
  return before !== store.observedPrices.length;
}

function snapshot(store) {
  const fuelhub = store || emptyFuelhub();
  return {
    truck: normalizeTruck(fuelhub.truck || {}),
    truckSource: fuelhub.truckSource || "default",
    truckSavedAt: fuelhub.truckSavedAt || null,
    lastPlan: fuelhub.lastPlan || null,
    cards: Array.isArray(fuelhub.cards) ? fuelhub.cards.map((c) => ({ ...c })) : [],
    observedPrices: Array.isArray(fuelhub.observedPrices)
      ? fuelhub.observedPrices.map((p) => ({ ...p }))
      : [],
    trips: Array.isArray(fuelhub.trips)
      ? fuelhub.trips.map((t) => ({ ...t, points: undefined, pointCount: (t.points || []).length }))
      : [],
    activeTrack: fuelhub.activeTrack
      ? {
          id: fuelhub.activeTrack.id,
          km: fuelhub.activeTrack.km || 0,
          startedAt: fuelhub.activeTrack.startedAt,
          updatedAt: fuelhub.activeTrack.updatedAt,
          pointCount: (fuelhub.activeTrack.points || []).length,
          lastPoint: lastPointFromTrack(fuelhub.activeTrack),
        }
      : null,
    employerContacts: Array.isArray(fuelhub.employerContacts)
      ? fuelhub.employerContacts.map(presentContact)
      : [],
    fuelReceipts: Array.isArray(fuelhub.fuelReceipts)
      ? fuelhub.fuelReceipts.map(presentReceipt)
      : [],
  };
}

function lastPointFromTrack(track) {
  const points = track && track.points;
  if (!Array.isArray(points) || !points.length) return null;
  const last = points[points.length - 1];
  if (!last || last.lat == null || last.lng == null) return null;
  return { lat: Number(last.lat), lng: Number(last.lng) };
}

module.exports = {
  emptyFuelhub,
  ensureFuelhub,
  saveTruck,
  normalizeCard,
  upsertCard,
  removeCard,
  recordObservedPrice,
  saveTrip,
  removeTrip,
  removeObservedPrice,
  saveLastPlan,
  appendTrack,
  snapshot,
};
