const {
  timeFactor,
  hopDistanceKm,
  buildHops,
  litresPerKmFor,
  averageUsage,
  predictRun,
  buildFuelForecast,
  splitVia,
} = require("./lib/fuel-forecast");
const { normalizeTruck } = require("./lib/fuel-efficiency");

describe("fuel usage forecast", () => {
  const rigid = normalizeTruck({
    combinationId: "rigid",
    driverType: "long_haul",
    payloadT: 10,
    tankCapacityL: 520,
    currentFuelL: 280,
    gcmT: 28,
    tareT: 12,
  });

  it("lifts L/km when the same distance takes more hours", () => {
    const fast = timeFactor({ hours: 8, distanceKm: 640 });
    const slow = timeFactor({ hours: 12, distanceKm: 640 });
    expect(slow).toBeGreaterThan(fast);
    const light = litresPerKmFor(rigid, {
      band: "regional",
      hours: 8,
      distanceKm: 640,
      payloadT: 6,
      fuelL: 150,
    });
    const heavySlow = litresPerKmFor(rigid, {
      band: "regional",
      hours: 12,
      distanceKm: 640,
      payloadT: 18,
      fuelL: 480,
    });
    expect(heavySlow).toBeGreaterThan(light);
  });

  it("averages L/km across saved trips and lists each run", () => {
    const avg = averageUsage(
      [
        {
          id: "1",
          origin: "St George",
          destination: "Longreach",
          distanceKm: 600,
          hours: 8,
          payloadT: 10,
          fuelLoadL: 300,
          planSummary: { fillL: 180 },
        },
        {
          id: "2",
          origin: "Barcaldine",
          destination: "Gracemere",
          distanceKm: 540,
          hours: 7.5,
          payloadT: 16,
          fuelLoadL: 250,
          planSummary: { fillL: 200 },
        },
      ],
      rigid
    );
    expect(avg.tripCount).toBe(2);
    expect(avg.trips).toHaveLength(2);
    expect(avg.litresPerKm).toBeGreaterThan(0.2);
    expect(avg.trips[1].litresPerKm).toBeGreaterThan(avg.trips[0].litresPerKm);
  });

  it("sizes a minimum Barcaldine fill to reach Gracemere with added freight", () => {
    const prediction = predictRun({
      origin: "St George",
      via: ["Longreach", "Barcaldine", "Emerald"],
      destination: "Gracemere",
      refillAt: "Barcaldine",
      payloadT: 10,
      addedPayloadT: 8,
      currentFuelL: 260,
      hours: 18,
      truck: rigid,
    });
    expect(prediction.distanceKm).toBeGreaterThan(1000);
    expect(prediction.hops.map((h) => h.to)).toEqual(["Longreach", "Barcaldine", "Emerald", "Gracemere"]);
    const refill = prediction.refillAdvice;
    expect(refill).toBeTruthy();
    expect(refill.place).toMatch(/barcaldine/i);
    expect(refill.minFillL).toBeGreaterThan(80);
    expect(refill.idealFillL).toBeGreaterThanOrEqual(refill.minFillL);
    expect(refill.extraVsMinL).toBeGreaterThan(0);
    expect(refill.tankFillL).toBeGreaterThan(refill.idealFillL);

    const names = prediction.scenarios.map((s) => s.name);
    expect(names).toEqual(["Conservative", "Baseline", "Optimistic"]);
    const cons = prediction.scenarios.find((s) => s.id === "conservative");
    const opt = prediction.scenarios.find((s) => s.id === "optimistic");
    expect(cons.litresPerKm).toBeGreaterThan(opt.litresPerKm);
    expect(cons.fillL).toBeGreaterThanOrEqual(opt.fillL);

    const afterRefill = prediction.hops.find((h) => h.from.toLowerCase() === "barcaldine");
    expect(afterRefill.payloadT).toBe(18);
    const toBarcaldine = prediction.hops.find((h) => h.to.toLowerCase() === "barcaldine");
    expect(toBarcaldine.payloadT).toBe(10);
    const toLongreach = prediction.hops.find((h) => h.to.toLowerCase() === "longreach");
    expect(toLongreach.payloadT).toBe(10);
    expect(toLongreach.hours).toBeGreaterThan(toBarcaldine.hours);
  });

  it("builds a Taxation Hub-style forecast snapshot from the store", () => {
    const forecast = buildFuelForecast({
      truck: rigid,
      store: {
        truck: rigid,
        trips: [
          {
            origin: "Roma",
            destination: "Longreach",
            distanceKm: 520,
            hours: 7,
            payloadT: 12,
            planSummary: { fillL: 160 },
          },
        ],
        cards: [],
      },
    });
    expect(forecast.average.tripCount).toBe(1);
    expect(forecast.scenarios).toHaveLength(3);
    expect(forecast.scenarios[0].name).toBe("Conservative");
    expect(forecast.scenarios[1].name).toBe("Baseline");
    expect(forecast.scenarios[2].name).toBe("Optimistic");
  });

  it("measures St George to Longreach as a real inland hop", () => {
    const km = hopDistanceKm("St George", "Longreach");
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(900);
    const hops = buildHops({
      origin: "St George",
      via: "Longreach, Barcaldine",
      destination: "Gracemere",
    });
    expect(hops.hops).toHaveLength(3);
  });

  it("splits via towns from commas or the word to", () => {
    expect(splitVia("Longreach, Barcaldine, Emerald")).toEqual(["Longreach", "Barcaldine", "Emerald"]);
    expect(splitVia("Longreach to Barcaldine")).toEqual(["Longreach", "Barcaldine"]);
  });
});
