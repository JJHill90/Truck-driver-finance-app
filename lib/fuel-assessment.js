/**
 * Live Fuel Hub run assessment: efficiency, distance vs plan, and safety
 * margin. Litres are planning estimates from the existing truck model plus
 * GPS movement / idle — not an ECU fuel-map.
 */

const { haversineKm } = require("./fuel-stations");
const {
  normalizeTruck,
  consumptionLPer100km,
  litresPerKm,
  rangeKm,
  reserveLitres,
} = require("./fuel-efficiency");
const { averageUsage, timeFactor } = require("./fuel-forecast");

const IDLE_SPEED_KMH = 3;
const MAX_SEGMENT_HOURS = 0.5;
const SAFETY_SLIM = 1.3;
const SAFETY_WATCH = 1.5;

const IDLE_L_PER_HOUR = {
  rigid: 2.4,
  semi: 3.2,
  b_double: 3.8,
  b_triple: 4.2,
  road_train_t1: 4.5,
  road_train_t2: 5.0,
};

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

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

function idleLitresPerHour(truck) {
  const spec = normalizeTruck(truck || {});
  return IDLE_L_PER_HOUR[spec.combinationId] || IDLE_L_PER_HOUR.semi;
}

function pointTime(point) {
  if (!point || !point.at) return null;
  const ms = new Date(point.at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function segmentsFromTrack(track) {
  const points = (track && track.points) || [];
  const segs = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const km = haversineKm(a, b);
    if (km == null || km >= 80) continue;
    const t0 = pointTime(a);
    const t1 = pointTime(b);
    const hours = t0 != null && t1 != null && t1 > t0 ? (t1 - t0) / 3600000 : 0;
    const gap = hours <= 0 || hours > MAX_SEGMENT_HOURS;
    const speedKmh = !gap && hours > 0 ? km / hours : null;
    const idle = Boolean(speedKmh != null && speedKmh < IDLE_SPEED_KMH);
    segs.push({
      km: round2(km),
      hours: round3(hours),
      speedKmh: speedKmh != null ? round1(speedKmh) : null,
      idle,
      gap,
    });
  }
  return segs;
}

function summariseTrack(track, truck, { band = "regional" } = {}) {
  const segs = segmentsFromTrack(track);
  const idleLph = idleLitresPerHour(truck);
  const cruiseLPerKm = litresPerKm(truck, { band });
  let movingKm = 0;
  let movingHours = 0;
  let idleHours = 0;
  let movingL = 0;
  let idleL = 0;
  let lastMoving = null;

  segs.forEach((seg) => {
    if (seg.gap) {
      movingKm += seg.km;
      movingL += cruiseLPerKm * seg.km;
      return;
    }
    if (seg.idle) {
      idleHours += seg.hours;
      idleL += idleLph * seg.hours;
      return;
    }
    movingKm += seg.km;
    movingHours += seg.hours;
    const factor = timeFactor({ hours: seg.hours, distanceKm: seg.km });
    movingL += cruiseLPerKm * factor * seg.km;
    lastMoving = seg;
  });

  const trackKm = num(track && track.km, movingKm);
  const instantSeg = lastMoving || segs.filter((s) => !s.idle && !s.gap).slice(-1)[0] || null;
  const lastSeg = segs[segs.length - 1] || null;
  let instantaneousLPer100km = null;
  let instantaneousLPerHour = null;
  let instantaneousMode = "model";
  if (lastSeg && lastSeg.idle && !lastSeg.gap) {
    instantaneousMode = "idle";
    instantaneousLPerHour = round1(idleLph);
  } else if (instantSeg && instantSeg.speedKmh != null) {
    instantaneousMode = "moving";
    const factor = timeFactor({ hours: instantSeg.hours, distanceKm: instantSeg.km });
    instantaneousLPer100km = round2(cruiseLPerKm * factor * 100);
  } else {
    instantaneousLPer100km = round2(cruiseLPerKm * 100);
  }

  return {
    segs,
    movingKm: round1(movingKm || trackKm),
    movingHours: round2(movingHours),
    idleHours: round2(idleHours),
    idleL: round1(idleL),
    movingL: round1(movingL),
    totalFuelConsumedL: round1(movingL + idleL),
    instantaneousLPer100km,
    instantaneousLPerHour,
    instantaneousMode,
    lastSpeedKmh: lastSeg && !lastSeg.idle ? lastSeg.speedKmh : instantSeg && instantSeg.speedKmh,
  };
}

function nextTarget(plan, achievedKm) {
  if (!plan) return null;
  const achieved = Math.max(0, num(achievedKm));
  const stops = Array.isArray(plan.stops) ? plan.stops : [];
  const nextStop = stops.find((s) => num(s.km) > achieved + 0.5);
  if (nextStop) {
    return {
      kind: "fill",
      label: nextStop.name || "Next fill",
      remainingKm: round1(num(nextStop.km) - achieved),
      atKm: round1(num(nextStop.km)),
    };
  }
  const advice = plan.forecast && plan.forecast.refillAdvice;
  if (advice && num(advice.remainingKm) > 0 && achieved < num(plan.distanceKm)) {
    const destKm = num(plan.distanceKm);
    const toDest = Math.max(0, destKm - achieved);
    const remaining = Math.min(toDest, num(advice.remainingKm));
    if (remaining > 0) {
      return {
        kind: "fill",
        label: advice.place || "Nominated refill",
        remainingKm: round1(remaining),
        atKm: null,
      };
    }
  }
  const planned = num(plan.distanceKm);
  if (planned > 0) {
    return {
      kind: "destination",
      label: plan.destination || "Destination",
      remainingKm: round1(Math.max(0, planned - achieved)),
      atKm: round1(planned),
    };
  }
  return null;
}

function safetyStatus(ratio, remainingKm) {
  if (remainingKm == null || remainingKm <= 0) return "clear";
  if (ratio == null) return "unknown";
  if (ratio < 1) return "stranded";
  if (ratio < SAFETY_SLIM) return "slim";
  if (ratio < SAFETY_WATCH) return "watch";
  return "ok";
}

function reserveStatus(fuelNowL, reserveL, tankL) {
  if (fuelNowL <= 0) return "empty";
  if (fuelNowL < reserveL) return "below_reserve";
  const pct = tankL > 0 ? fuelNowL / tankL : 0;
  if (pct < 0.1) return "below_reserve";
  if (pct < 0.15) return "tight";
  return "ok";
}

function buildAssessment({ store, hub, efficiency, band = "regional" } = {}) {
  const truck = normalizeTruck({
    ...((store && store.truck) || {}),
    driverType: (hub && hub.driverType) || (store && store.truck && store.truck.driverType),
  });
  const track = store && store.activeTrack;
  const plan = store && store.lastPlan;
  const trips = (store && store.trips) || [];
  const avg = averageUsage(trips, truck);
  const live = summariseTrack(track, truck, { band });
  const cruiseLPer100 = efficiency && efficiency.consumptionLPer100km
    ? efficiency.consumptionLPer100km
    : consumptionLPer100km(truck, { band, driverType: truck.driverType });

  const tripKm = live.movingKm || num(track && track.km);
  const historyLPer100 = avg.litresPer100km > 0 ? avg.litresPer100km : cruiseLPer100;
  const liveLPer100 =
    tripKm > 1 && live.totalFuelConsumedL > 0
      ? round2((live.totalFuelConsumedL / tripKm) * 100)
      : null;
  const averageLPer100km = liveLPer100
    ? round2((historyLPer100 * Math.max(avg.totalKm, 1) + liveLPer100 * tripKm) / (Math.max(avg.totalKm, 1) + tripKm))
    : round2(historyLPer100);

  const startFuelL = num(truck.currentFuelL);
  const consumedL = live.totalFuelConsumedL;
  const fuelNowL = round1(Math.max(0, startFuelL - consumedL));
  const reserveL = reserveLitres(truck);
  const dteKm = rangeKm({ ...truck, currentFuelL: fuelNowL }, { band, fuelL: fuelNowL });
  const target = nextTarget(plan, tripKm);
  const remainingKm = target ? target.remainingKm : null;
  const safetyRatio =
    remainingKm != null && remainingKm > 0 ? round2(dteKm / remainingKm) : null;
  const plannedKm = num(plan && plan.distanceKm);
  const lastTrip = trips[0] || null;
  const lastTripPlan = lastTrip ? num(lastTrip.distanceKm) : 0;
  const liveVariance = plannedKm > 0 && tripKm > 0 ? round1(tripKm - plannedKm) : null;
  const savedVariance =
    lastTrip && num(lastTrip.gpsKm) > 0 && lastTripPlan > 0
      ? round1(num(lastTrip.gpsKm) - lastTripPlan)
      : null;
  const distanceVarianceKm = liveVariance != null ? liveVariance : savedVariance;
  const marginL = round1(fuelNowL - reserveL);
  const tankPct = truck.tankCapacityL > 0 ? round1((fuelNowL / truck.tankCapacityL) * 100) : 0;

  return {
    band,
    truck: {
      combinationId: truck.combinationId,
      combinationLabel: truck.combinationLabel,
      driverType: truck.driverType,
      tankCapacityL: truck.tankCapacityL,
      startFuelL,
      fuelNowL,
      reserveL,
      reservePercent: truck.reservePercent,
    },
    efficiency: {
      averageLPer100km: round2(averageLPer100km),
      averageKmPerLitre: averageLPer100km > 0 ? round2(100 / averageLPer100km) : 0,
      modelledLPer100km: round2(cruiseLPer100),
      instantaneousLPer100km: live.instantaneousLPer100km,
      instantaneousLPerHour: live.instantaneousLPerHour,
      instantaneousMode: live.instantaneousMode,
      totalFuelConsumedL: consumedL,
      sampleTrips: avg.tripCount,
    },
    distance: {
      tripKm: round1(tripKm),
      plannedKm: plannedKm || null,
      targetRemainingKm: remainingKm,
      targetLabel: target ? target.label : null,
      targetKind: target ? target.kind : null,
      varianceKm: distanceVarianceKm,
      lastSpeedKmh: live.lastSpeedKmh || null,
    },
    safety: {
      rangeKm: dteKm,
      safetyRatio,
      safetyStatus: safetyStatus(safetyRatio, remainingKm),
      reserveMarginL: marginL,
      fuelNowL,
      reserveL,
      tankPercent: tankPct,
      reserveStatus: reserveStatus(fuelNowL, reserveL, truck.tankCapacityL),
      idleHours: live.idleHours,
      idleL: live.idleL,
      idleLPerHour: round1(idleLitresPerHour(truck)),
      movingL: live.movingL,
    },
    note:
      "Figures are Fuel Hub planning estimates from load, tank, GPS movement and idle time — not a manufacturer fuel map. Keep a 10–15% tank buffer; a safety ratio under 1.3 means distance-to-empty is too close to the remaining run.",
  };
}

module.exports = {
  IDLE_SPEED_KMH,
  SAFETY_SLIM,
  IDLE_L_PER_HOUR,
  idleLitresPerHour,
  segmentsFromTrack,
  summariseTrack,
  nextTarget,
  safetyStatus,
  buildAssessment,
};
