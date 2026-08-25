/**
 * Fuel Hub usage forecast — Conservative / Baseline / Optimistic,
 * matching Taxation Hub’s scenario chart, for real-time fill decisions.
 *
 * L/km comes from freight mass, diesel mass in the tanks, and time on the
 * road (slower loaded running lifts litres). History is per trip and as a
 * km-weighted average. Predictions size a minimum / ideal fill so a driver
 * does not buy extra expensive west-QLD diesel just to top the tank.
 */

const { matchCorridor, regionBandAtKm } = require("./fuel-nhvr");
const { haversineKm, listStations } = require("./fuel-stations");
const {
  normalizeTruck,
  consumptionLPer100km,
  litresForDistance,
  reserveLitres,
} = require("./fuel-efficiency");
const { bestDiscountForRetailer, effectiveCpl, roundCpl } = require("./fuel-prices");

const LINEHAUL_KMH = 80;
const ROAD_FACTOR = 1.22;

/** Inland / depot towns used for hop distances when a corridor km column does not apply. */
const PLACE_COORDS = {
  "st george": { lat: -28.037, lng: 148.58, band: "remote" },
  mitchell: { lat: -26.485, lng: 147.969, band: "remote" },
  roma: { lat: -26.567, lng: 148.787, band: "remote" },
  charleville: { lat: -26.402, lng: 146.238, band: "remote" },
  longreach: { lat: -23.442, lng: 144.249, band: "outback_west" },
  barcaldine: { lat: -23.553, lng: 145.289, band: "remote" },
  alpha: { lat: -23.654, lng: 146.638, band: "remote" },
  emerald: { lat: -23.525, lng: 148.162, band: "regional" },
  duaringa: { lat: -23.722, lng: 149.671, band: "regional" },
  gracemere: { lat: -23.437, lng: 150.456, band: "regional" },
  rockhampton: { lat: -23.378, lng: 150.51, band: "regional" },
  brisbane: { lat: -27.47, lng: 153.025, band: "metro" },
  toowoomba: { lat: -27.56, lng: 151.954, band: "regional" },
  sydney: { lat: -33.868, lng: 151.209, band: "metro" },
  melbourne: { lat: -37.814, lng: 144.963, band: "metro" },
};

const SCENARIOS = [
  {
    id: "conservative",
    name: "Conservative",
    usageMultiplier: 1.12,
    bufferPercent: 18,
    note: "Heavier running, slower hours and a larger reserve — carry enough diesel if the west premium bites.",
  },
  {
    id: "baseline",
    name: "Baseline",
    usageMultiplier: 1,
    bufferPercent: 8,
    note: "Observed / model average for this freight and fuel mass.",
  },
  {
    id: "optimistic",
    name: "Optimistic",
    usageMultiplier: 0.9,
    bufferPercent: 0,
    note: "Highway pace and minimum fill — only the litres needed to the next planned town.",
  },
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePlace(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function placeName(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return String(value.name || value.label || "").trim();
}

function coordsOf(place) {
  if (!place) return null;
  if (typeof place === "object" && place.lat != null) {
    return { lat: Number(place.lat), lng: Number(place.lng != null ? place.lng : place.lon) };
  }
  const key = normalizePlace(place);
  if (PLACE_COORDS[key]) return PLACE_COORDS[key];
  const stations = listStations();
  const hit = stations.find((s) => normalizePlace(s.name).includes(key) || key.includes(normalizePlace(s.name).split(" ").slice(-1)[0]));
  if (hit) return { lat: hit.lat, lng: hit.lng, band: hit.band };
  return null;
}

function bandOf(place, corridor, km) {
  const coords = coordsOf(place);
  if (coords && coords.band) return coords.band;
  return regionBandAtKm(corridor, km);
}

/**
 * Time on the road lifts L/km: slower loaded running and more rest/idle.
 * 80 km/h linehaul = 1.0; 60 km/h ≈ 1.12; 90 km/h ≈ 0.96.
 */
function timeFactor({ hours, distanceKm } = {}) {
  const km = num(distanceKm);
  const hrs = num(hours);
  if (km <= 0 || hrs <= 0) return 1;
  const speed = km / hrs;
  return round2(clamp(LINEHAUL_KMH / Math.max(40, speed), 0.92, 1.22));
}

function hopDistanceKm(from, to) {
  const a = coordsOf(from);
  const b = coordsOf(to);
  if (a && b) {
    const great = haversineKm(a, b);
    if (great) return round2(great * ROAD_FACTOR);
  }
  return 0;
}

function splitVia(via) {
  if (Array.isArray(via)) {
    return via
      .flatMap((v) => String(v || "").split(/[,/]| to /i))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  return String(via || "")
    .split(/[,/]| to /i)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function buildHops({ origin, via, destination }) {
  const stops = [placeName(origin), ...splitVia(via), placeName(destination)].filter(Boolean);
  const hops = [];
  let kmCursor = 0;
  for (let i = 1; i < stops.length; i += 1) {
    const from = stops[i - 1];
    const to = stops[i];
    const km = hopDistanceKm(from, to) || 120;
    kmCursor += km;
    hops.push({ from, to, distanceKm: km, kmAtEnd: round2(kmCursor) });
  }
  return { stops, hops, distanceKm: round2(kmCursor) };
}

function litresPerKmFor(truck, { band, fuelL, hours, distanceKm, payloadT } = {}) {
  const spec = normalizeTruck({
    ...(truck || {}),
    payloadT: payloadT != null && payloadT !== "" ? payloadT : truck && truck.payloadT,
    currentFuelL: fuelL != null ? fuelL : truck && truck.currentFuelL,
  });
  const cons = consumptionLPer100km(spec, { band: band || "regional", fuelL: spec.currentFuelL });
  const timed = cons * timeFactor({ hours, distanceKm });
  return round3(timed / 100);
}

function hoursFromTrack(trip) {
  const points = trip && trip.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0] && points[0].at;
  const last = points[points.length - 1] && points[points.length - 1].at;
  if (!first || !last) return null;
  const ms = new Date(last).getTime() - new Date(first).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return round2(ms / 3600000);
}

function tripUsage(trip, truck = {}) {
  const km = num(trip && (trip.distanceKm || trip.gpsKm));
  if (km <= 0) return null;
  const hours =
    num(trip && trip.hours) ||
    hoursFromTrack(trip) ||
    round2(km / LINEHAUL_KMH);
  const payloadT = num(trip && (trip.payloadT != null ? trip.payloadT : trip.freightT), truck.payloadT);
  const fuelLoadL = num(trip && trip.fuelLoadL, truck.currentFuelL);
  const fillL = num(trip && trip.planSummary && trip.planSummary.fillL);
  const fromFill = fillL > 0 ? fillL / km : 0;
  const modelled = litresPerKmFor(truck, {
    band: "regional",
    fuelL: fuelLoadL,
    hours,
    distanceKm: km,
    payloadT,
  });
  const litresPerKm = fromFill > 0.05 && fromFill < 2 ? round3(fromFill) : modelled;
  return {
    id: trip.id,
    origin: trip.origin,
    destination: trip.destination,
    via: trip.via || [],
    distanceKm: round2(km),
    hours,
    avgSpeedKmh: round2(km / Math.max(0.1, hours)),
    payloadT: round2(payloadT),
    fuelLoadL: round1(fuelLoadL),
    litresPerKm,
    litresPer100km: round2(litresPerKm * 100),
    fillL: fillL || round1(litresPerKm * km),
    createdAt: trip.createdAt,
  };
}

function averageUsage(trips, truck = {}) {
  const rows = (trips || []).map((t) => tripUsage(t, truck)).filter(Boolean);
  const km = rows.reduce((s, r) => s + r.distanceKm, 0);
  const hours = rows.reduce((s, r) => s + r.hours, 0);
  const litreKm = km > 0 ? rows.reduce((s, r) => s + r.litresPerKm * r.distanceKm, 0) / km : 0;
  const payload =
    km > 0 ? rows.reduce((s, r) => s + r.payloadT * r.distanceKm, 0) / km : num(truck.payloadT);
  return {
    tripCount: rows.length,
    totalKm: round2(km),
    totalHours: round2(hours),
    litresPerKm: round3(litreKm),
    litresPer100km: round2(litreKm * 100),
    avgPayloadT: round2(payload),
    avgSpeedKmh: hours > 0 ? round2(km / hours) : LINEHAUL_KMH,
    trips: rows,
  };
}

function scenarioUsage(baseLPerKm, scenario) {
  return round3(baseLPerKm * scenario.usageMultiplier);
}

function nearestPricedSite(place, cards, observedPrices) {
  const coords = coordsOf(place);
  const stations = listStations({ observedPrices });
  let best = null;
  let bestKm = Infinity;
  for (const s of stations) {
    if (!s.truckAccess) continue;
    const km = coords ? haversineKm(coords, s) : normalizePlace(s.name).includes(normalizePlace(place)) ? 0 : 999;
    if (km == null || km > 90) continue;
    if (km < bestKm) {
      bestKm = km;
      best = s;
    }
  }
  if (!best) return null;
  const discount = bestDiscountForRetailer(best.retailerId, cards);
  const cpl = effectiveCpl(best.pumpCpl, discount);
  return {
    stationId: best.id,
    name: best.name,
    band: best.band,
    effectiveCpl: cpl,
    distanceKm: round2(bestKm),
  };
}

function fillAdvice({ needL, tankCapacityL, currentFuelL, scenario }) {
  const room = Math.max(0, tankCapacityL - currentFuelL);
  const minFill = clamp(Math.max(0, needL), 0, room);
  const buffered = minFill * (1 + (scenario.bufferPercent || 0) / 100);
  const idealFill = clamp(buffered, minFill, room);
  const tankFill = room;
  return {
    minFillL: round1(minFill),
    idealFillL: round1(idealFill),
    tankFillL: round1(tankFill),
    extraVsMinL: round1(Math.max(0, tankFill - minFill)),
  };
}

function predictRun(input = {}) {
  const truck = normalizeTruck(input.truck || {});
  const cards = input.cards || [];
  const origin = placeName(input.origin);
  const destination = placeName(input.destination);
  const built = buildHops({ origin, via: input.via, destination });
  const corridor = matchCorridor(origin, destination, splitVia(input.via));
  const refillAt = normalizePlace(input.refillAt || input.refuelAt);
  const payloadT = num(input.payloadT, truck.payloadT);
  const addedPayloadT = Math.max(0, num(input.addedPayloadT, 0));
  const totalHours = num(input.hours);
  const avg = input.average && input.average.litresPerKm > 0 ? input.average : null;

  let fuelL = num(input.currentFuelL, truck.currentFuelL);
  const reserveL = reserveLitres(truck);

  const hops = [];
  let kmCursor = 0;
  let loadT = payloadT;
  let passedRefill = false;
  const baseSamples = [];

  for (const hop of built.hops) {
    if (passedRefill) loadT = payloadT + addedPayloadT;
    const hours =
      totalHours > 0 && built.distanceKm > 0
        ? totalHours * (hop.distanceKm / built.distanceKm)
        : hop.distanceKm / LINEHAUL_KMH;
    const band = bandOf(hop.to, corridor, kmCursor + hop.distanceKm / 2);
    const modelled = litresPerKmFor(truck, {
      band,
      fuelL,
      hours,
      distanceKm: hop.distanceKm,
      payloadT: loadT,
    });
    const baseLPerKm = avg ? round3((avg.litresPerKm + modelled) / 2) : modelled;
    baseSamples.push(baseLPerKm);
    const isRefill = Boolean(refillAt && normalizePlace(hop.to) === refillAt);
    hops.push({
      from: hop.from,
      to: hop.to,
      distanceKm: hop.distanceKm,
      hours: round2(hours),
      payloadT: round2(loadT),
      band,
      litresPerKm: baseLPerKm,
      litresPer100km: round2(baseLPerKm * 100),
      fuelOnArrivalL: round1(fuelL),
      refillHere: isRefill,
      site: nearestPricedSite(hop.to, cards, input.observedPrices),
    });
    if (isRefill) passedRefill = true;
    kmCursor += hop.distanceKm;
  }

  const baselineLPerKm =
    baseSamples.length > 0 ? round3(baseSamples.reduce((s, n) => s + n, 0) / baseSamples.length) : 0.3;

  const scenarios = SCENARIOS.map((scenario) => {
    let fuel = num(input.currentFuelL, truck.currentFuelL);
    const hopOut = [];
    let fillL = 0;
    let costAud = 0;
      hops.forEach((hop, idx) => {
      const lPerKm = scenarioUsage(hop.litresPerKm, scenario);
      const burn = lPerKm * hop.distanceKm;
      const arrive = Math.max(0, fuel - burn);
      const remainingHops = hops.slice(idx + 1);
      const remainingKm = remainingHops.reduce((s, h) => s + h.distanceKm, 0);
      const remainingBurn = remainingHops.reduce(
        (s, h) => s + scenarioUsage(h.litresPerKm, scenario) * h.distanceKm,
        0
      );
      const needThrough = remainingBurn + reserveL - arrive;
      const advice = hop.refillHere
        ? fillAdvice({
            needL: needThrough,
            tankCapacityL: truck.tankCapacityL,
            currentFuelL: arrive,
            scenario,
          })
        : fillAdvice({
            needL: arrive < reserveL ? reserveL - arrive : 0,
            tankCapacityL: truck.tankCapacityL,
            currentFuelL: arrive,
            scenario,
          });
      const takeL = hop.refillHere ? advice.idealFillL : arrive < reserveL ? advice.minFillL : 0;
      const cpl = hop.site && hop.site.effectiveCpl != null ? hop.site.effectiveCpl : 210;
      const hopCost = round2((takeL * cpl) / 100);
      fillL += takeL;
      costAud += hopCost;
      fuel = arrive + takeL;
      hopOut.push({
        ...hop,
        litresPerKm: lPerKm,
        litresPer100km: round2(lPerKm * 100),
        burnL: round1(burn),
        fuelOnArrivalL: round1(arrive),
        fillL: round1(takeL),
        minFillL: advice.minFillL,
        idealFillL: advice.idealFillL,
        tankFillL: advice.tankFillL,
        extraVsMinL: advice.extraVsMinL,
        costAud: hopCost,
        fuelOnDepartureL: round1(fuel),
        remainingKm: round2(remainingKm),
      });
    });
    return {
      id: scenario.id,
      name: scenario.name,
      note: scenario.note,
      usageMultiplier: scenario.usageMultiplier,
      litresPerKm: scenarioUsage(baselineLPerKm, scenario),
      litresPer100km: round2(scenarioUsage(baselineLPerKm, scenario) * 100),
      fillL: round1(fillL),
      costAud: round2(costAud),
      hops: hopOut,
    };
  });

  const baseline = scenarios.find((s) => s.id === "baseline");
  const refillHop = (baseline && baseline.hops.find((h) => h.refillHere)) || null;

  return {
    origin,
    destination,
    via: splitVia(input.via),
    refillAt: refillAt ? placeName(input.refillAt || input.refuelAt) : "",
    corridor: {
      id: corridor.id,
      name: corridor.name,
      matched: Boolean(corridor.matched),
      westPremium: Boolean(corridor.westPremium),
    },
    truck,
    payloadT: round2(payloadT),
    addedPayloadT: round2(addedPayloadT),
    distanceKm: built.distanceKm,
    hours: totalHours > 0 ? round2(totalHours) : round2(built.distanceKm / LINEHAUL_KMH),
    timeFactor: timeFactor({
      hours: totalHours > 0 ? totalHours : built.distanceKm / LINEHAUL_KMH,
      distanceKm: built.distanceKm,
    }),
    averageLitresPerKm: baselineLPerKm,
    averageLitresPer100km: round2(baselineLPerKm * 100),
    reserveL,
    scenarios,
    refillAdvice: refillHop
      ? {
          place: refillHop.to,
          site: refillHop.site,
          minFillL: refillHop.minFillL,
          idealFillL: refillHop.idealFillL,
          tankFillL: refillHop.tankFillL,
          extraVsMinL: refillHop.extraVsMinL,
          remainingKm: refillHop.remainingKm,
          note: `Take about ${refillHop.idealFillL} L at ${refillHop.to} (minimum ${refillHop.minFillL} L) to cover the remaining ${refillHop.remainingKm} km with the loaded freight — filling the tank would buy ${refillHop.extraVsMinL} L extra.`,
        }
      : null,
    hops: (baseline && baseline.hops) || hops,
    note:
      "Conservative / Baseline / Optimistic follow the same idea as Taxation Hub Forecast. Litres/km move with freight tonnes, diesel mass in the tanks, and hours on the road. Minimum fill is the litres needed to the next planned town plus reserve — not a full tank at an inflated bowser.",
  };
}

function buildFuelForecast({ store, truck, input } = {}) {
  const spec = normalizeTruck((truck || (store && store.truck)) || {});
  const average = averageUsage(store && store.trips, spec);
  const prediction =
    input && (input.origin || input.destination)
      ? predictRun({
          ...input,
          truck: spec,
          cards: (store && store.cards) || input.cards || [],
          observedPrices: (store && store.observedPrices) || input.observedPrices || [],
          average,
        })
      : null;
  return {
    mode: "realtime",
    average,
    trips: average.trips,
    scenarios: SCENARIOS.map((s) => ({
      id: s.id,
      name: s.name,
      note: s.note,
      usageMultiplier: s.usageMultiplier,
      litresPerKm: scenarioUsage(average.litresPerKm || litresPerKmFor(spec, { band: "regional" }), s),
      litresPer100km: round2(
        scenarioUsage(average.litresPerKm || litresPerKmFor(spec, { band: "regional" }), s) * 100
      ),
    })),
    prediction,
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

module.exports = {
  LINEHAUL_KMH,
  PLACE_COORDS,
  SCENARIOS,
  timeFactor,
  hopDistanceKm,
  buildHops,
  litresPerKmFor,
  tripUsage,
  averageUsage,
  predictRun,
  buildFuelForecast,
  coordsOf,
  splitVia,
};
