const {
  combinationFromLicence,
  presentHubProfile,
  seedTruckFromHubProfile,
} = require("./lib/hub-profile");
const { ensureFuelhub, saveTruck } = require("./lib/fuelhub-store");

describe("hub profile sharing", () => {
  it("maps Taxation Hub licence class to a Fuel Hub combination", () => {
    expect(combinationFromLicence("lr_mr")).toBe("rigid");
    expect(combinationFromLicence("hr")).toBe("rigid");
    expect(combinationFromLicence("hc", "short_haul")).toBe("semi");
    expect(combinationFromLicence("hc", "long_haul")).toBe("b_double");
    expect(combinationFromLicence("mc")).toBe("b_double");
  });

  it("presents the same Driver Hub identity future apps can read", () => {
    const hub = presentHubProfile(
      { username: "james.smith", email: "james@fleet.test", displayPlan: "Pro+", isPro: true },
      {
        profile: {
          name: "James Smith",
          employer: "Betts Transport",
          driverType: "long_haul",
          licenceClass: "mc",
          annualSalary: 125000,
          financialYear: "2025-26",
          cars: [{ id: "1" }],
        },
      }
    );
    expect(hub.linked).toBe(true);
    expect(hub.displayName).toBe("James Smith");
    expect(hub.employer).toBe("Betts Transport");
    expect(hub.licenceLabel).toBe("MC");
    expect(hub.suggestedCombinationId).toBe("b_double");
    expect(hub.workCarCount).toBe(1);
    expect(hub.apps).toContain("fuelhub");
    expect(hub.apps).toContain("taxationhub");
  });

  it("seeds Fuel Hub truck from the profile until the driver saves a spec", () => {
    const records = {
      profile: { licenceClass: "hr", driverType: "local", name: "Sam", employer: "Local Freight" },
    };
    const hub = presentHubProfile({ username: "sam" }, records);
    const store = ensureFuelhub(records, { hubProfile: hub });
    expect(store.truck.combinationId).toBe("rigid");
    expect(store.truckSource).toBe("hub_profile");
    saveTruck(store, { combinationId: "b_double", tankCapacityL: 1400, currentFuelL: 700 });
    expect(store.truckSavedAt).toBeTruthy();
    expect(store.truckSource).toBe("user");
    const again = seedTruckFromHubProfile(store, hub);
    expect(again.seeded).toBe(false);
    expect(store.truck.combinationId).toBe("b_double");
    expect(store.truck.tankCapacityL).toBe(1400);
  });

  it("does not overwrite a Fuel Hub truck that was saved before profile linking", () => {
    const records = {
      profile: { licenceClass: "hr", driverType: "local" },
      fuelhub: {
        truck: { combinationId: "b_double", tankCapacityL: 1500, currentFuelL: 900, trailers: 2, gcmT: 62.5, tareT: 22, payloadT: 30 },
        cards: [],
      },
    };
    const hub = presentHubProfile({ username: "sam" }, records);
    const store = ensureFuelhub(records, { hubProfile: hub });
    expect(store.truck.combinationId).toBe("b_double");
    expect(store.truck.tankCapacityL).toBe(1500);
    expect(store.truckSource).toBe("user");
  });
});
