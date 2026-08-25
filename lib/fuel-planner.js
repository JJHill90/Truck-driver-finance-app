/**
 * Fuel-stop planner: cheapest truck-legal fills, rest/refresh, west premium.
 *
 * Prefers NHVR freight-corridor stations over consumer-map detours. Fills
 * before remote/outback_west price step-ups when the extra litres beat buying
 * dear diesel later.
 */

const {
  matchCorridor,
  regionBandAtKm,
  accessWarnings,
  combinationAllowedOnCorridor,
} = require("./fuel-nhvr");
const { bestDiscountForRetailer, effectiveCpl, roundCpl } = require("./fuel-prices");
const { stationsOnCorridor, listStations, haversineKm } = require("./fuel-stations");
const {
  normalizeTruck,
  consumptionLPer100km,
  litresForDistance,
  reserveLitres,
  rangeKm,
} = require("./fuel-efficiency");

const REST_EVERY_KM = 420;
const REST_EVERY_HOURS = 5.25;
const LINEHAUL_KMH = 80;

function stationAccessOk(station, truck) {
  const spec = normalizeTruck(truck);
  if (spec.combinationId === "road_train_t2" && !station.roadTrain) return false;
  if (spec.combinationId === "road_train_t1" && !station.roadTrain && !station.bDouble) return false;
  if (spec.combinationId === "b_triple" && !station.roadTrain && !station.bDouble) return false;
  if ((spec.combinationId === "b_double" || spec.combinationId === "semi") && !station.truckAccess) {
    return false;
  }
  return true;
}

function pricedStation(station, cards) {
  const discount = bestDiscountForRetailer(station.retailerId, cards);
  const pumpCpl = station.pumpCpl != null ? station.pumpCpl : station.tableCpl;
  const netCpl = effectiveCpl(pumpCpl, discount);
  return {
    ...station,
    pumpCpl,
    discount,
    effectiveCpl: netCpl,
  };
}

function estimateDistanceKm({ origin, destination, corridor, distanceKm }) {
  if (Number(distanceKm) > 0) return Math.round(Number(distanceKm) * 10) / 10;
  if (corridor && corridor.matched && corridor.distanceKm) return corridor.distanceKm;
  const a = coordsOf(origin);
  const b = coordsOf(destination);
  if (a && b) {
    const great = haversineKm(a, b);
    if (great) return Math.round(great * 1.28 * 10) / 10;
  }
  return 650;
}

function coordsOf(place) {
  if (!place || typeof place === "string") return null;
  if (place.lat != null && (place.lng != null || place.lon != null)) {
    return { lat: Number(place.lat), lng: Number(place.lng != null ? place.lng : place.lon) };
  }
  return null;
}

function placeName(place) {
  if (!place) return "";
  if (typeof place === "string") return place;
  return place.name || place.label || "";
}

function buildCandidateStations({ corridor, truck, cards, observedPrices, origin, destination }) {
  let rows = [];
  if (corridor && corridor.matched) {
    rows = stationsOnCorridor(corridor.id, observedPrices);
  } else {
    const a = coordsOf(origin);
    const b = coordsOf(destination);
    rows = listStations({ observedPrices }).filter((s) => {
      if (!a || !b) return s.truckAccess;
      const da = haversineKm(a, s);
      const db = haversineKm(b, s);
      const ab = haversineKm(a, b) || 0;
      return da != null && db != null && da + db <= ab * 1.35 + 40;
    });
    rows.sort((x, y) => (x.km || 0) - (y.km || 0));
  }
  return rows
    .filter((s) => stationAccessOk(s, truck))
    .map((s) => pricedStation(s, cards));
}

function bandAt(corridor, km) {
  return regionBandAtKm(corridor, km);
}

function planFuelStops(input = {}) {
  const truck = normalizeTruck(input.truck || {});
  const cards = input.cards || [];
  const origin = input.origin || "";
  const destination = input.destination || "";
  const via = input.via || [];
  const corridor = matchCorridor(origin, destination, via);
  const totalKm = estimateDistanceKm({
    origin,
    destination,
    corridor,
    distanceKm: input.distanceKm,
  });
  const warnings = accessWarnings({
    combinationId: truck.combinationId,
    corridor,
    lengthM: truck.lengthM,
    heightM: truck.heightM,
  });
  const corridorAccess = combinationAllowedOnCorridor(truck.combinationId, corridor);
  if (!corridorAccess.ok && !warnings.includes(corridorAccess.reason)) {
    warnings.push(corridorAccess.reason);
  }

  const stations = buildCandidateStations({
    corridor,
    truck,
    cards,
    observedPrices: input.observedPrices || [],
    origin,
    destination,
  }).filter((s) => s.km == null || s.km <= totalKm + 30);

  const reserveL = reserveLitres(truck);
  let fuelL = truck.currentFuelL;
  let kmCursor = 0;
  const stops = [];
  const skipped = [];

  function rangeFrom(km, litres) {
    const band = bandAt(corridor, km);
    return rangeKm({ ...truck, currentFuelL: litres }, { band, fuelL: litres });
  }

  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i];
    const stationKm = station.km != null ? station.km : Math.round(((i + 1) / (stations.length + 1)) * totalKm);
    const hop = Math.max(0, stationKm - kmCursor);
    const burn = litresForDistance(hop, truck, {
      band: bandAt(corridor, kmCursor + hop / 2),
      fuelL,
    });
    if (fuelL - burn < 0) {
      warnings.push(
        `Cannot reach ${station.name} on current fuel — add an earlier fill or a driver-entered waypoint.`
      );
      break;
    }
    fuelL -= burn;
    kmCursor = stationKm;

    const next = stations[i + 1];
    const nextKm = next ? next.km != null ? next.km : stationKm + 120 : totalKm;
    const hopNext = Math.max(0, nextKm - stationKm);
    const burnNext = litresForDistance(hopNext, truck, {
      band: bandAt(corridor, stationKm + hopNext / 2),
      fuelL,
    });
    const fuelIfSkip = fuelL - burnNext;
    const canSkip = fuelIfSkip > reserveL;

    const hereCpl = station.effectiveCpl;
    const laterCheap = stations.slice(i + 1).find((s) => {
      const sKm = s.km != null ? s.km : nextKm;
      const need = litresForDistance(sKm - stationKm, truck, {
        band: bandAt(corridor, stationKm),
        fuelL,
      });
      return fuelL - need > reserveL && s.effectiveCpl <= hereCpl - 2;
    });

    const upcomingWest = stations.slice(i + 1).some((s) => s.band === "outback_west" || s.band === "remote");
    const hereIsCheapBand = station.band === "metro" || station.band === "regional";
    const priceStepUp = upcomingWest && hereIsCheapBand && hereCpl + 8 < (next && next.effectiveCpl ? next.effectiveCpl : hereCpl + 20);

    const mustStop = !canSkip || fuelL <= reserveL + 20;
    const opportunistic = priceStepUp && fuelL < truck.tankCapacityL * 0.82;
    const localMinimum = !laterCheap && (!next || hereCpl + 1.5 < (next.effectiveCpl || hereCpl));

    if (!mustStop && !opportunistic && !localMinimum) {
      skipped.push({ id: station.id, name: station.name, reason: "Cheaper or reachable fill later in range." });
      continue;
    }

    const targetPct = opportunistic || priceStepUp ? 0.94 : mustStop ? 0.88 : 0.8;
    const targetL = truck.tankCapacityL * targetPct;
    const fillL = Math.max(0, round1(targetL - fuelL));
    if (fillL < 40 && !mustStop) {
      skipped.push({ id: station.id, name: station.name, reason: "Already carrying enough diesel." });
      continue;
    }
    const costAud = round2((fillL * hereCpl) / 100);
    const reason = mustStop
      ? "Required — next hop would dip under reserve."
      : opportunistic
        ? "Fill before remote / out-west prices step up."
        : "Cheapest effective diesel in range (card + table).";

    stops.push({
      stationId: station.id,
      name: station.name,
      retailerId: station.retailerId,
      km: stationKm,
      band: station.band,
      lat: station.lat,
      lng: station.lng,
      truckAccess: station.truckAccess,
      amenities: station.amenities || [],
      pumpCpl: station.pumpCpl,
      effectiveCpl: hereCpl,
      discount: station.discount,
      fillL,
      costAud,
      fuelOnArrivalL: round1(fuelL),
      fuelOnDepartureL: round1(fuelL + fillL),
      rangeAfterKm: round1(rangeFrom(stationKm, fuelL + fillL)),
      reason,
      refresh: (station.amenities || []).includes("shower") || (station.amenities || []).includes("food"),
    });
    fuelL += fillL;
  }

  const remaining = Math.max(0, totalKm - kmCursor);
  if (remaining > 0) {
    const burnHome = litresForDistance(remaining, truck, {
      band: bandAt(corridor, kmCursor + remaining / 2),
      fuelL,
    });
    fuelL = round1(fuelL - burnHome);
    if (fuelL < reserveL) {
      warnings.push(
        "Arrives under reserve — add a driver-entered fuel point or start with more diesel."
      );
    }
  }

  const refreshStops = recommendRefresh(totalKm, stations);
  const avgCpl = stops.length
    ? roundCpl(stops.reduce((s, x) => s + x.effectiveCpl * x.fillL, 0) / Math.max(1, stops.reduce((s, x) => s + x.fillL, 0)))
    : null;
  const totalFillL = round1(stops.reduce((s, x) => s + x.fillL, 0));
  const totalCost = round2(stops.reduce((s, x) => s + x.costAud, 0));
  const startBand = bandAt(corridor, 0);
  const startCons = consumptionLPer100km(truck, { band: startBand });
  if (truck.classCode) {
    warnings.unshift(
      `${truck.classCode} registered fuel class · ${truck.tankCapacityL} L carrying capacity — fill spacing follows this tank, not a generic ${truck.combinationLabel}.`
    );
  }

  return {
    origin: placeName(origin),
    destination: placeName(destination),
    via,
    corridor: {
      id: corridor.id,
      name: corridor.name,
      matched: Boolean(corridor.matched),
      westPremium: Boolean(corridor.westPremium),
      nhvrNetworks: corridor.nhvrNetworks || [],
    },
    truck,
    distanceKm: totalKm,
    consumptionLPer100km: startCons,
    litresPerKm: round2(startCons / 100),
    startRangeKm: rangeKm(truck, { band: startBand }),
    reserveL,
    stops,
    skipped,
    refreshStops,
    totals: {
      fillL: totalFillL,
      costAud: totalCost,
      averageEffectiveCpl: avgCpl,
      arrivalFuelL: Math.max(0, fuelL),
    },
    warnings,
    sourcesNote:
      "Pump cpl uses government-style city/region tables unless you logged a bowser price. Cards and company cents-off apply before ranking. Confirm NHVR access for the combination — Fuel Hub will not send a B-double down a car-nav shortcut.",
  };
}

function recommendRefresh(totalKm, stations) {
  const out = [];
  let nextAt = REST_EVERY_KM;
  const hours = totalKm / LINEHAUL_KMH;
  const restCount = Math.max(Math.floor(hours / REST_EVERY_HOURS), Math.floor(totalKm / REST_EVERY_KM));
  for (let i = 0; i < restCount; i += 1) {
    const target = nextAt;
    const withFacilities = stations.filter(
      (s) => s.km != null && (s.amenities || []).some((a) => a === "food" || a === "shower" || a === "parking")
    );
    let best = null;
    let bestDelta = Infinity;
    for (const s of withFacilities) {
      const delta = Math.abs(s.km - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = s;
      }
    }
    if (best && bestDelta <= 160) {
      out.push({
        km: best.km,
        stationId: best.id,
        name: best.name,
        amenities: best.amenities || [],
        note: `NHVR-style rest window (~every ${REST_EVERY_HOURS} h / ${REST_EVERY_KM} km). Refuel and refresh here if it also ranks as a cheap truck-access fill.`,
      });
    }
    nextAt += REST_EVERY_KM;
  }
  return out;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = {
  planFuelStops,
  stationAccessOk,
  pricedStation,
  REST_EVERY_KM,
  REST_EVERY_HOURS,
};
