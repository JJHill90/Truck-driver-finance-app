/**
 * Fuel Hub home dashboard: current run, saved trips, and cheapest truck-access
 * diesel nearby using NHVR corridor sites + government-style public tables
 * (ACCC / FuelWatch / FuelCheck shaped), minus fuel cards.
 */

const {
  listStations,
  nearestStations,
  stationsOnCorridor,
} = require("./fuel-stations");
const {
  bestDiscountForRetailer,
  effectiveCpl,
  governmentTables,
} = require("./fuel-prices");
const {
  combinationAllowedOnCorridor,
  getCombination,
  listCorridors,
  matchCorridor,
} = require("./fuel-nhvr");
const { describeEfficiency, rangeKm } = require("./fuel-efficiency");

const NHVR_PLANNER = "https://www.nhvr.gov.au/road-access/route-planner";

function stationFitsCombination(station, combinationId) {
  if (!station || !station.truckAccess) return false;
  const combo = getCombination(combinationId);
  const id = combo && combo.id;
  if (id === "b_double" || id === "b_triple") return Boolean(station.bDouble);
  if (id === "road_train_t1" || id === "road_train_t2") return Boolean(station.roadTrain);
  return true;
}

function decorateStation(station, cards) {
  const discount = bestDiscountForRetailer(station.retailerId, cards);
  const cpl = effectiveCpl(station.pumpCpl, discount);
  return {
    id: station.id,
    name: station.name,
    retailerId: station.retailerId,
    corridorId: station.corridorId,
    band: station.band,
    capital: station.capital,
    km: station.km,
    lat: station.lat,
    lng: station.lng,
    distanceKm: station.distanceKm != null ? Math.round(station.distanceKm * 10) / 10 : null,
    truckAccess: Boolean(station.truckAccess),
    bDouble: Boolean(station.bDouble),
    amenities: [...(station.amenities || [])],
    tableCpl: station.tableCpl,
    observedCpl: station.observedCpl,
    pumpCpl: station.pumpCpl,
    effectiveCpl: cpl,
    discount,
    source: station.observedCpl != null ? "bowser" : "government_table",
  };
}

function lastTrackPoint(store) {
  const points = store && store.activeTrack && store.activeTrack.points;
  if (!Array.isArray(points) || !points.length) return null;
  const last = points[points.length - 1];
  if (!last || last.lat == null || last.lng == null) return null;
  return { lat: Number(last.lat), lng: Number(last.lng) };
}

function corridorForPlan(plan) {
  if (!plan || !plan.corridor) return null;
  const id = plan.corridor.id || plan.corridor;
  return listCorridors().find((c) => c.id === id) || plan.corridor;
}

function areaDeals({ store, hub, point, truck } = {}) {
  const cards = (store && store.cards) || [];
  const observed = (store && store.observedPrices) || [];
  const combinationId = (truck && truck.combinationId) || (hub && hub.workCombination) || "semi";
  const gpsPoint = point || lastTrackPoint(store);
  const lastPlan = store && store.lastPlan;
  const tables = governmentTables();

  let stations = [];
  let areaLabel = "";
  let areaKind = "networks";
  let corridorName = "";

  if (gpsPoint) {
    stations = nearestStations(gpsPoint, { limit: 16, maxKm: 160, observedPrices: observed });
    areaLabel = "Truck-access diesel within 160 km of your current GPS";
    areaKind = "gps";
  } else if (lastPlan && lastPlan.corridor) {
    const corridor = corridorForPlan(lastPlan);
    corridorName = (corridor && corridor.name) || lastPlan.corridor.name || lastPlan.corridor.id;
    stations = stationsOnCorridor(lastPlan.corridor.id || lastPlan.corridor, observed);
    areaLabel = `Cheapest gazetted truck sites on ${corridorName} (last planned run)`;
    areaKind = "corridor";
  } else {
    const trips = (store && store.trips) || [];
    const hint = trips[0];
    if (hint && hint.origin && hint.destination) {
      const corridor = matchCorridor(hint.origin, hint.destination);
      if (corridor && corridor.id) {
        corridorName = corridor.name;
        stations = stationsOnCorridor(corridor.id, observed);
        areaLabel = `Cheapest gazetted truck sites on ${corridor.name} (last saved trip)`;
        areaKind = "last_trip";
      }
    }
    if (!stations.length) {
      stations = listStations({ observedPrices: observed });
      areaLabel =
        "No GPS yet — cheapest truck-access diesel on NHVR-gazetted sites that fit your work vehicle";
      areaKind = "networks";
    }
  }

  const corridors = listCorridors();
  const ranked = stations
    .filter((s) => {
      if (!stationFitsCombination(s, combinationId)) return false;
      const corridor = corridors.find((c) => c.id === s.corridorId);
      if (!corridor) return true;
      return combinationAllowedOnCorridor(combinationId, corridor).ok;
    })
    .map((s) => decorateStation(s, cards))
    .filter((s) => s.effectiveCpl != null)
    .sort((a, b) => a.effectiveCpl - b.effectiveCpl || (a.distanceKm || 0) - (b.distanceKm || 0))
    .slice(0, 8);

  return {
    areaKind,
    areaLabel,
    corridorName: corridorName || null,
    combinationId,
    gps: gpsPoint,
    deals: ranked,
    sources: tables.sources,
    nhvrNote:
      "Access follows NHVR freight-corridor and combination rules, not Apple/Google car shortcuts. Confirm the NHVR Route Planner for permits and last-mile. Diesel ¢/L uses ACCC / FuelWatch / FuelCheck-style public tables unless you logged a bowser price; fuel cards come off after that.",
    nhvrPlannerUrl: NHVR_PLANNER,
  };
}

function currentJourney({ store, hub, efficiency } = {}) {
  const track = store && store.activeTrack;
  const plan = store && store.lastPlan;
  const truck = store && store.truck;
  const eff =
    efficiency ||
    describeEfficiency(truck || {}, { driverType: hub && hub.driverType });
  const remainingKm = rangeKm(truck || {}, { band: "regional" });
  const lastPoint = lastTrackPoint(store);
  return {
    hasGps: Boolean(track && (track.km || (track.points && track.points.length))),
    track: track
      ? {
          id: track.id,
          km: track.km || 0,
          startedAt: track.startedAt,
          updatedAt: track.updatedAt,
          pointCount: (track.points || []).length,
          lastPoint,
        }
      : null,
    plan: plan || null,
    remainingKm,
    consumptionLPer100km: eff.consumptionLPer100km,
    combinationLabel: (truck && truck.combinationLabel) || (hub && hub.workCombinationLabel),
    driverTypeLabel: hub && hub.driverTypeLabel,
    fuelClassCode: (truck && truck.classCode) || (hub && hub.activeFuelVehicle && hub.activeFuelVehicle.classCode) || null,
    fuelClassLabel:
      (hub && hub.activeFuelVehicle && hub.activeFuelVehicle.classLabel) ||
      (truck && truck.classCode) ||
      null,
    tankCapacityL: truck && truck.tankCapacityL,
    currentFuelL: truck && truck.currentFuelL,
  };
}

function previousJourneys(store) {
  const trips = (store && store.trips) || [];
  return trips.slice(0, 12).map((t) => ({
    id: t.id,
    origin: t.origin,
    destination: t.destination,
    via: t.via || [],
    distanceKm: t.distanceKm || t.gpsKm || 0,
    gpsKm: t.gpsKm || 0,
    mode: t.mode,
    fillL: t.planSummary && t.planSummary.fillL,
    costAud: t.planSummary && t.planSummary.costAud,
    corridor: t.planSummary && t.planSummary.corridor,
    createdAt: t.createdAt,
  }));
}

function journeyStats(trips) {
  const rows = previousJourneys({ trips });
  const km = rows.reduce((s, t) => s + (Number(t.distanceKm) || 0), 0);
  const fillL = rows.reduce((s, t) => s + (Number(t.fillL) || 0), 0);
  const costAud = rows.reduce((s, t) => s + (Number(t.costAud) || 0), 0);
  return {
    tripCount: rows.length,
    totalKm: Math.round(km * 10) / 10,
    totalFillL: Math.round(fillL * 10) / 10,
    totalCostAud: Math.round(costAud * 100) / 100,
  };
}

function buildDashboard({ store, hub, point, efficiency } = {}) {
  const truck = store && store.truck;
  return {
    hubProfile: hub || null,
    currentJourney: currentJourney({ store, hub, efficiency }),
    previousJourneys: previousJourneys(store),
    journeyStats: journeyStats(store && store.trips),
    areaDeals: areaDeals({ store, hub, point, truck }),
  };
}

function summarisePlan(plan) {
  if (!plan) return null;
  return {
    origin: plan.origin,
    destination: plan.destination,
    via: plan.via || [],
    distanceKm: plan.distanceKm,
    corridor: plan.corridor
      ? {
          id: plan.corridor.id,
          name: plan.corridor.name,
          matched: plan.corridor.matched,
          westPremium: plan.corridor.westPremium,
        }
      : null,
    consumptionLPer100km: plan.consumptionLPer100km,
    totals: plan.totals
      ? {
          fillL: plan.totals.fillL,
          costAud: plan.totals.costAud,
          averageEffectiveCpl: plan.totals.averageEffectiveCpl,
        }
      : null,
    stops: (plan.stops || []).slice(0, 12).map((s) => ({
      stationId: s.stationId,
      name: s.name,
      km: s.km,
      fillL: s.fillL,
      costAud: s.costAud,
      effectiveCpl: s.effectiveCpl,
      band: s.band,
      reason: s.reason,
    })),
    warnings: (plan.warnings || []).slice(0, 8),
    plannedAt: new Date().toISOString(),
  };
}

module.exports = {
  NHVR_PLANNER,
  stationFitsCombination,
  decorateStation,
  lastTrackPoint,
  areaDeals,
  currentJourney,
  previousJourneys,
  journeyStats,
  buildDashboard,
  summarisePlan,
};
