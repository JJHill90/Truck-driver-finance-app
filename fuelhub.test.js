const {
  consumptionLPer100km,
  rangeKm,
  normalizeTruck,
  operatingMassT,
  litresForDistance,
  reserveLitres,
} = require("./lib/fuel-efficiency");
const { planFuelStops } = require("./lib/fuel-planner");
const { matchCorridor, accessWarnings, combinationAllowedOnCorridor } = require("./lib/fuel-nhvr");
const { effectiveCpl, bestDiscountForRetailer, tableDieselCpl, governmentTables } = require("./lib/fuel-prices");
const { haversineKm, trackDistanceKm, stationsOnCorridor } = require("./lib/fuel-stations");
const { upsertCard, ensureFuelhub, recordObservedPrice, saveTrip, removeTrip, removeCard, removeObservedPrice } = require("./lib/fuelhub-store");
const { buildDashboard, areaDeals } = require("./lib/fuel-dashboard");

describe("fuel efficiency", () => {
  const base = {
    combinationId: "b_double",
    trailers: 2,
    payloadT: 30,
    gcmT: 62.5,
    tareT: 22,
    tankCapacityL: 1200,
    currentFuelL: 700,
  };

  it("burns more diesel as payload, trailers and fuel mass rise", () => {
    const light = consumptionLPer100km({ ...base, payloadT: 8, currentFuelL: 200 }, { band: "regional" });
    const heavy = consumptionLPer100km({ ...base, payloadT: 38, currentFuelL: 1100 }, { band: "regional" });
    expect(heavy).toBeGreaterThan(light);

    const oneTrailer = consumptionLPer100km({ ...base, combinationId: "semi", trailers: 1 }, { band: "regional" });
    const extraTrailer = consumptionLPer100km({ ...base, combinationId: "semi", trailers: 2 }, { band: "regional" });
    expect(extraTrailer).toBeGreaterThan(oneTrailer);
  });

  it("counts diesel weight in operating mass", () => {
    const emptyTanks = operatingMassT({ ...base, currentFuelL: 100 });
    const fullTanks = operatingMassT({ ...base, currentFuelL: 1200 });
    expect(fullTanks).toBeGreaterThan(emptyTanks);
    expect(fullTanks - emptyTanks).toBeCloseTo((1100 * 0.84) / 1000, 1);
  });

  it("uses more fuel out west than on a regional highway", () => {
    const regional = consumptionLPer100km(base, { band: "regional" });
    const west = consumptionLPer100km(base, { band: "outback_west" });
    expect(west).toBeGreaterThan(regional);
  });

  it("range shrinks as the tank empties and never plans below reserve", () => {
    const full = rangeKm({ ...base, currentFuelL: 1200 });
    const low = rangeKm({ ...base, currentFuelL: 150 });
    expect(full).toBeGreaterThan(low);
    expect(reserveLitres(base)).toBeGreaterThanOrEqual(80);
    expect(litresForDistance(100, base)).toBeGreaterThan(40);
  });

  it("uses more fuel for local stop-start than linehaul on the same combination", () => {
    const linehaul = consumptionLPer100km({ ...base, driverType: "long_haul" }, { band: "regional" });
    const local = consumptionLPer100km({ ...base, driverType: "local" }, { band: "regional" });
    expect(local).toBeGreaterThan(linehaul);
  });

  it("uses more fuel for a linehaul B-double than a linehaul rigid", () => {
    const rigid = consumptionLPer100km(
      { combinationId: "rigid", driverType: "long_haul", payloadT: 10, gcmT: 28, tareT: 12, tankCapacityL: 400, currentFuelL: 220 },
      { band: "regional" }
    );
    const bdouble = consumptionLPer100km({ ...base, driverType: "long_haul" }, { band: "regional" });
    expect(bdouble).toBeGreaterThan(rigid);
  });

  it("normalises truck defaults from combination", () => {
    const truck = normalizeTruck({ combinationId: "road_train_t1" });
    expect(truck.tankCapacityL).toBeGreaterThanOrEqual(1400);
    expect(truck.trailers).toBeGreaterThanOrEqual(2);
    expect(truck.licence).toBe("mc");
  });
});

describe("NHVR corridors", () => {
  it("matches Sydney–Melbourne to the Hume, not a car-nav shortcut", () => {
    const corridor = matchCorridor("Sydney", "Melbourne");
    expect(corridor.id).toBe("hume");
    expect(corridor.matched).toBe(true);
    expect(corridor.nhvrNetworks).toContain("b_double");
  });

  it("flags road trains off the Hume and west-premium on the Eyre", () => {
    const hume = matchCorridor("Sydney", "Albury");
    const train = combinationAllowedOnCorridor("road_train_t2", hume);
    expect(train.ok).toBe(false);

    const eyre = matchCorridor("Adelaide", "Perth");
    expect(eyre.id).toBe("eyre");
    const warnings = accessWarnings({
      combinationId: "b_double",
      corridor: eyre,
      heightM: 4.6,
    });
    expect(warnings.join(" ")).toMatch(/west|remote/i);
    expect(warnings.join(" ")).toMatch(/4\.3/);
  });
});

describe("prices and cards", () => {
  it("loads remote/outback diesel above metro on the public-table bands", () => {
    const metro = tableDieselCpl({ band: "metro", capital: "sydney" });
    const west = tableDieselCpl({ band: "outback_west", capital: "sydney" });
    expect(west).toBeGreaterThan(metro + 30);
    const tables = governmentTables();
    expect(tables.sources.length).toBeGreaterThan(2);
    expect(tables.cities.find((c) => c.city === "darwin").dieselCpl).toBeGreaterThan(
      tables.cities.find((c) => c.city === "melbourne").dieselCpl
    );
  });

  it("applies retailer cards and company cents-off", () => {
    const discount = bestDiscountForRetailer("bp", [
      { retailerId: "bp", name: "BP Plus", cplOff: 6 },
      { companyWide: true, companyCplOff: 2, name: "Fleet" },
    ]);
    expect(discount.cardCplOff).toBe(6);
    expect(discount.companyCplOff).toBe(2);
    expect(effectiveCpl(190, discount)).toBe(182);
  });
});

describe("fuel planner", () => {
  const truck = {
    combinationId: "b_double",
    trailers: 2,
    payloadT: 32,
    gcmT: 62.5,
    tareT: 22,
    tankCapacityL: 1200,
    currentFuelL: 380,
  };

  it("uses higher L/100 km on a planned run for local duty than linehaul", () => {
    const linehaul = planFuelStops({
      origin: "Sydney",
      destination: "Melbourne",
      truck: { ...truck, driverType: "long_haul" },
    });
    const local = planFuelStops({
      origin: "Sydney",
      destination: "Melbourne",
      truck: { ...truck, driverType: "local" },
    });
    expect(local.consumptionLPer100km).toBeGreaterThan(linehaul.consumptionLPer100km);
  });

  it("plans Hume fills at truck-access sites and skips car-only 7-Eleven", () => {
    const plan = planFuelStops({
      origin: "Sydney",
      destination: "Melbourne",
      truck,
      cards: [{ retailerId: "bp", name: "BP Plus", cplOff: 8 }],
    });
    expect(plan.corridor.id).toBe("hume");
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.stops.every((s) => s.truckAccess)).toBe(true);
    expect(plan.stops.some((s) => /7-Eleven/i.test(s.name))).toBe(false);
    expect(plan.consumptionLPer100km).toBeGreaterThan(30);
    expect(plan.litresPerKm).toBeGreaterThan(0.3);
  });

  it("fills before out-west price step-ups on the Warrego", () => {
    const plan = planFuelStops({
      origin: "Brisbane",
      destination: "Mount Isa",
      truck: { ...truck, currentFuelL: 900 },
      cards: [],
    });
    expect(plan.corridor.westPremium).toBe(true);
    expect(plan.stops.length).toBeGreaterThan(0);
    const reasons = plan.stops.map((s) => s.reason).join(" ");
    expect(reasons).toMatch(/west|remote|Required|Cheapest/i);
    const first = plan.stops[0];
    expect(["metro", "regional", "remote"]).toContain(first.band);
  });

  it("uses driver-entered distance when no corridor matches", () => {
    const plan = planFuelStops({
      origin: "Depot yard",
      destination: "Farm gate",
      distanceKm: 220,
      truck: { combinationId: "rigid", currentFuelL: 350, tankCapacityL: 400, payloadT: 8, gcmT: 22 },
    });
    expect(plan.distanceKm).toBe(220);
    expect(plan.corridor.matched).toBe(false);
  });
});

describe("GPS and store", () => {
  it("accumulates haversine track distance", () => {
    const km = trackDistanceKm([
      { lat: -33.87, lng: 151.21 },
      { lat: -34.0, lng: 151.1 },
      { lat: -34.2, lng: 150.9 },
    ]);
    expect(km).toBeGreaterThan(20);
    expect(haversineKm({ lat: -33.87, lng: 151.21 }, { lat: -37.81, lng: 144.96 })).toBeGreaterThan(700);
  });

  it("stores fuel cards and bowser overlays", () => {
    const records = {};
    const store = ensureFuelhub(records);
    const card = upsertCard(store, { name: "AmpolCard", retailerId: "ampol", cplOff: 5, company: "Betts" });
    expect(card.retailerId).toBe("ampol");
    const price = recordObservedPrice(store, { stationId: "bp-marulan", cpl: 179.9 });
    expect(price.cpl).toBe(179.9);
    const marulan = stationsOnCorridor("hume", store.observedPrices).find((s) => s.id === "bp-marulan");
    expect(marulan.pumpCpl).toBe(179.9);
  });
});

describe("fuel hub dashboard", () => {
  it("ranks GPS-area truck sites by effective ¢/L from government tables", () => {
    const dash = buildDashboard({
      store: {
        truck: normalizeTruck({ combinationId: "b_double", driverType: "long_haul" }),
        cards: [],
        observedPrices: [],
        trips: [],
      },
      hub: {
        workCombination: "b_double",
        driverType: "long_haul",
        driverTypeLabel: "Linehaul driver",
        workCombinationLabel: "B-double",
      },
      point: { lat: -34.711, lng: 150.005 },
    });
    expect(dash.areaDeals.areaKind).toBe("gps");
    expect(dash.areaDeals.deals.length).toBeGreaterThan(0);
    expect(dash.areaDeals.deals.every((d) => d.truckAccess)).toBe(true);
    const first = dash.areaDeals.deals[0].effectiveCpl;
    const last = dash.areaDeals.deals[dash.areaDeals.deals.length - 1].effectiveCpl;
    expect(first).toBeLessThanOrEqual(last);
    expect(dash.areaDeals.sources.some((s) => /accc/i.test(s.id) || /FuelWatch/i.test(s.name))).toBe(true);
  });

  it("summarises the current planned run and previous trips", () => {
    const dash = buildDashboard({
      store: {
        truck: normalizeTruck({ combinationId: "b_double" }),
        lastPlan: {
          origin: "Sydney",
          destination: "Melbourne",
          distanceKm: 840,
          corridor: { id: "hume", name: "Hume Highway" },
          consumptionLPer100km: 54.5,
          totals: { fillL: 659.5, costAud: 1286.03 },
        },
        trips: [
          {
            id: "1",
            origin: "Brisbane",
            destination: "Mount Isa",
            distanceKm: 1820,
            createdAt: "2026-08-01T00:00:00.000Z",
            planSummary: { fillL: 900, costAud: 2100, corridor: "warrego" },
          },
        ],
        cards: [],
        observedPrices: [],
      },
      hub: { workCombination: "b_double", driverTypeLabel: "Linehaul driver" },
    });
    expect(dash.currentJourney.plan.origin).toBe("Sydney");
    expect(dash.previousJourneys[0].destination).toBe("Mount Isa");
    expect(dash.journeyStats.tripCount).toBe(1);
    expect(dash.journeyStats.totalFillL).toBe(900);
  });

  it("does not list car-only 7-Eleven Craigieburn as a B-double deal", () => {
    const deals = areaDeals({
      store: { cards: [], observedPrices: [] },
      hub: { workCombination: "b_double" },
      truck: { combinationId: "b_double" },
      point: { lat: -37.599, lng: 144.941 },
    });
    expect(deals.deals.some((d) => /craigieburn/i.test(d.name))).toBe(false);
  });
});

describe("Fuel Hub admin add/remove/save helpers", () => {
  it("adds and removes cards, trips and observed prices", () => {
    const records = { profile: {} };
    const store = ensureFuelhub(records);
    const card = upsertCard(store, { name: "BP Plus", retailerId: "bp", cplOff: 6 });
    expect(store.cards).toHaveLength(1);
    expect(removeCard(store, card.id)).toBe(true);
    expect(store.cards).toHaveLength(0);

    const trip = saveTrip(store, { origin: "St George", destination: "Gracemere", distanceKm: 670 });
    expect(store.trips[0].id).toBe(trip.id);
    expect(removeTrip(store, trip.id)).toBe(true);
    expect(store.trips).toHaveLength(0);

    recordObservedPrice(store, { stationId: "site-1", cpl: 189.5 });
    expect(store.observedPrices).toHaveLength(1);
    expect(removeObservedPrice(store, "site-1")).toBe(true);
    expect(store.observedPrices).toHaveLength(0);
  });
});
