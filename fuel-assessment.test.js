const {
  idleLitresPerHour,
  summariseTrack,
  nextTarget,
  safetyStatus,
  buildAssessment,
  SAFETY_SLIM,
} = require("./lib/fuel-assessment");
const { normalizeTruck } = require("./lib/fuel-efficiency");

describe("fuel assessment", () => {
  const truck = normalizeTruck({
    combinationId: "b_double",
    driverType: "long_haul",
    payloadT: 30,
    tankCapacityL: 1200,
    currentFuelL: 700,
  });

  it("idles more litres per hour on a B-double than a rigid", () => {
    expect(idleLitresPerHour({ combinationId: "b_double" })).toBeGreaterThan(
      idleLitresPerHour({ combinationId: "rigid" })
    );
  });

  it("splits GPS movement from idle and estimates litres burned", () => {
    const start = new Date("2026-11-03T00:00:00.000Z").getTime();
    const track = {
      km: 55,
      points: [
        { lat: -33.87, lng: 151.21, at: new Date(start).toISOString() },
        { lat: -33.87, lng: 151.21, at: new Date(start + 30 * 60 * 1000).toISOString() },
        { lat: -34.28, lng: 150.9, at: new Date(start + 55 * 60 * 1000).toISOString() },
      ],
    };
    const live = summariseTrack(track, truck);
    expect(live.idleHours).toBeCloseTo(0.5, 1);
    expect(live.idleL).toBeGreaterThan(1);
    expect(live.movingKm).toBeGreaterThan(50);
    expect(live.totalFuelConsumedL).toBeGreaterThan(live.idleL);
    expect(live.instantaneousMode).toBe("moving");
    expect(live.instantaneousLPer100km).toBeGreaterThan(40);
  });

  it("treats a last idle GPS segment as instantaneous idle burn", () => {
    const start = new Date("2026-11-03T00:00:00.000Z").getTime();
    const track = {
      points: [
        { lat: -27.47, lng: 153.025, at: new Date(start).toISOString() },
        { lat: -27.47, lng: 153.025, at: new Date(start + 20 * 60 * 1000).toISOString() },
      ],
    };
    const live = summariseTrack(track, truck);
    expect(live.instantaneousMode).toBe("idle");
    expect(live.instantaneousLPerHour).toBe(idleLitresPerHour(truck));
    expect(live.movingKm).toBe(0);
  });

  it("uses the next planned fill as the remaining-distance target", () => {
    const target = nextTarget(
      {
        origin: "Sydney",
        destination: "Melbourne",
        distanceKm: 840,
        stops: [
          { name: "BP Truckstop Marulan", km: 160 },
          { name: "Shell Gundagai", km: 390 },
        ],
      },
      40
    );
    expect(target.kind).toBe("fill");
    expect(target.label).toMatch(/Marulan/);
    expect(target.remainingKm).toBeCloseTo(120, 0);
  });

  it("flags a safety ratio under 1.3 as slim", () => {
    expect(safetyStatus(1.1, 200)).toBe("slim");
    expect(safetyStatus(0.9, 200)).toBe("stranded");
    expect(safetyStatus(1.8, 200)).toBe("ok");
    expect(SAFETY_SLIM).toBe(1.3);
  });

  it("builds dashboard metrics from tank, plan, GPS and trip history", () => {
    const start = new Date("2026-11-03T00:00:00.000Z").getTime();
    const assessment = buildAssessment({
      store: {
        truck,
        lastPlan: {
          origin: "Sydney",
          destination: "Melbourne",
          distanceKm: 840,
          stops: [{ name: "BP Truckstop Marulan", km: 160, fillL: 200 }],
        },
        trips: [
          {
            id: "1",
            origin: "Brisbane",
            destination: "Roma",
            distanceKm: 480,
            gpsKm: 510,
            hours: 6.5,
            payloadT: 28,
            fuelLoadL: 700,
            planSummary: { fillL: 280 },
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        activeTrack: {
          km: 40,
          points: [
            { lat: -33.87, lng: 151.21, at: new Date(start).toISOString() },
            { lat: -34.15, lng: 150.6, at: new Date(start + 40 * 60 * 1000).toISOString() },
          ],
        },
      },
      hub: { driverType: "long_haul" },
    });
    expect(assessment.efficiency.averageLPer100km).toBeGreaterThan(30);
    expect(assessment.efficiency.totalFuelConsumedL).toBeGreaterThan(0);
    expect(assessment.distance.tripKm).toBeGreaterThan(20);
    expect(assessment.distance.targetRemainingKm).toBeGreaterThan(50);
    expect(assessment.distance.targetKind).toBe("fill");
    expect(assessment.safety.rangeKm).toBeGreaterThan(100);
    expect(assessment.safety.safetyRatio).toBeGreaterThan(1);
    expect(assessment.safety.reserveMarginL).toBeGreaterThan(0);
    expect(["ok", "watch", "slim", "stranded"]).toContain(assessment.safety.safetyStatus);
    expect(assessment.distance.varianceKm).not.toBeNull();
  });

  it("marks a short remaining hop as slim when the tank cannot cover 1.3× the distance", () => {
    const dry = normalizeTruck({
      combinationId: "semi",
      driverType: "long_haul",
      payloadT: 20,
      tankCapacityL: 600,
      currentFuelL: 95,
    });
    const assessment = buildAssessment({
      store: {
        truck: dry,
        lastPlan: {
          origin: "Charleville",
          destination: "Longreach",
          distanceKm: 420,
          stops: [{ name: "Ampol Longreach", km: 420 }],
        },
        trips: [],
        activeTrack: { km: 300, points: [] },
      },
    });
    expect(assessment.distance.targetRemainingKm).toBeCloseTo(120, 0);
    expect(assessment.safety.safetyRatio).toBeLessThan(SAFETY_SLIM);
    expect(["slim", "stranded"]).toContain(assessment.safety.safetyStatus);
  });
});
