const {
  listFuelClasses,
  normalizeClassCode,
  normalizeFuelVehicle,
  normalizeFuelVehicles,
  activeFuelVehicle,
  applyClassToTruck,
  upsertFuelVehicle,
} = require("./lib/fuel-vehicle-class");
const { presentHubProfile, truckDefaultsFromHubProfile } = require("./lib/hub-profile");
const { ensureFuelhub, saveTruck } = require("./lib/fuelhub-store");
const { planFuelStops } = require("./lib/fuel-planner");
const { normalizeTruck, rangeKm } = require("./lib/fuel-efficiency");

describe("registered fuel-capacity classes", () => {
  it("catalogues the sample class codes with distinct tanks", () => {
    const ids = listFuelClasses().map((c) => c.id);
    expect(ids).toEqual(["XN93DX", "YN16BQ", "YN17BQ"]);
    const byId = Object.fromEntries(listFuelClasses().map((c) => [c.id, c]));
    expect(byId.XN93DX.tankCapacityL).toBe(380);
    expect(byId.YN16BQ.tankCapacityL).toBe(520);
    expect(byId.YN17BQ.tankCapacityL).toBe(680);
    expect(byId.YN17BQ.tankCapacityL).toBeGreaterThan(byId.XN93DX.tankCapacityL);
  });

  it("normalises a driver-entered class and keeps custom tank litres", () => {
    expect(normalizeClassCode("xn93dx")).toBe("XN93DX");
    const custom = normalizeFuelVehicle({
      classCode: "ab12cd",
      registration: "xyz123",
      tankCapacityL: 610,
      currentFuelL: 200,
      active: true,
    });
    expect(custom.classCode).toBe("AB12CD");
    expect(custom.catalog).toBe(false);
    expect(custom.tankCapacityL).toBe(610);
    expect(custom.registration).toBe("XYZ123");
  });

  it("prefills catalog tank litres when the driver omits them", () => {
    const row = normalizeFuelVehicle({ classCode: "XN93DX", registration: "HR1", active: true });
    expect(row.tankCapacityL).toBe(380);
    expect(row.classLabel).toMatch(/compact/i);
  });

  it("only one registered vehicle is active at a time", () => {
    const list = normalizeFuelVehicles([
      { id: "a", classCode: "XN93DX", active: true },
      { id: "b", classCode: "YN17BQ", active: true },
    ]);
    expect(list.filter((v) => v.active)).toHaveLength(1);
    expect(list[0].active).toBe(true);
    expect(list[1].active).toBe(false);
  });

  it("exposes the active class on the shared Driver Hub profile", () => {
    const hub = presentHubProfile(
      { username: "sam" },
      {
        profile: {
          licenceClass: "hr",
          driverType: "local",
          workCombination: "rigid",
          fuelVehicles: [
            { id: "v1", classCode: "YN16BQ", registration: "HR16", active: true, currentFuelL: 280 },
          ],
        },
      }
    );
    expect(hub.workCombination).toBe("rigid");
    expect(hub.activeFuelVehicle.classCode).toBe("YN16BQ");
    expect(hub.activeFuelVehicle.tankCapacityL).toBe(520);
    expect(hub.fuelVehicles).toHaveLength(1);
  });

  it("seeds Fuel Hub tank from the registered class instead of a generic rigid 400 L", () => {
    const hub = presentHubProfile(
      { username: "sam" },
      {
        profile: {
          licenceClass: "hr",
          driverType: "long_haul",
          workCombination: "rigid",
          fuelVehicles: [{ classCode: "YN17BQ", registration: "HR17", active: true }],
        },
      }
    );
    const truck = truckDefaultsFromHubProfile(hub);
    expect(truck.combinationId).toBe("rigid");
    expect(truck.tankCapacityL).toBe(680);
    expect(truck.classCode).toBe("YN17BQ");
    expect(truck.tankCapacityL).toBeGreaterThan(normalizeTruck({ combinationId: "rigid" }).tankCapacityL);
  });

  it("overlays class tank even after the driver saved a Fuel Hub truck spec", () => {
    const records = {
      profile: {
        licenceClass: "hr",
        driverType: "long_haul",
        workCombination: "rigid",
        fuelVehicles: [{ id: "v1", classCode: "XN93DX", active: true, currentFuelL: 200 }],
      },
    };
    const hub = presentHubProfile({ username: "sam" }, records);
    const store = ensureFuelhub(records, { hubProfile: hub });
    saveTruck(store, { combinationId: "rigid", tankCapacityL: 900, currentFuelL: 500, payloadT: 9 }, { hubProfile: hub });
    const again = ensureFuelhub(records, { hubProfile: hub });
    expect(again.truck.combinationId).toBe("rigid");
    expect(again.truck.tankCapacityL).toBe(380);
    expect(again.truck.classCode).toBe("XN93DX");
    expect(again.truck.currentFuelL).toBe(380);
    expect(again.truck.payloadT).toBe(9);
  });

  it("plans a longer range and fewer-or-equal fills for YN17BQ than XN93DX on the same rigid Hume run", () => {
    const compact = applyClassToTruck(
      { combinationId: "rigid", driverType: "long_haul", payloadT: 10, gcmT: 28, tareT: 12 },
      { classCode: "XN93DX", tankCapacityL: 380, currentFuelL: Math.round(380 * 0.55) }
    );
    const longRange = applyClassToTruck(
      { combinationId: "rigid", driverType: "long_haul", payloadT: 10, gcmT: 28, tareT: 12 },
      { classCode: "YN17BQ", tankCapacityL: 680, currentFuelL: Math.round(680 * 0.55) }
    );
    expect(rangeKm(compact)).toBeLessThan(rangeKm(longRange));
    const smallPlan = planFuelStops({ origin: "Sydney", destination: "Melbourne", truck: compact });
    const largePlan = planFuelStops({ origin: "Sydney", destination: "Melbourne", truck: longRange });
    expect(smallPlan.startRangeKm).toBeLessThan(largePlan.startRangeKm);
    expect(smallPlan.stops.length).toBeGreaterThanOrEqual(largePlan.stops.length);
    expect(smallPlan.warnings.join(" ")).toMatch(/XN93DX/);
    expect(largePlan.truck.tankCapacityL).toBe(680);
  });

  it("upserts a new class onto the profile list", () => {
    const next = upsertFuelVehicle([], { classCode: "YN16BQ", registration: "test1", active: true });
    expect(activeFuelVehicle(next).classCode).toBe("YN16BQ");
    expect(next).toHaveLength(1);
  });
});
