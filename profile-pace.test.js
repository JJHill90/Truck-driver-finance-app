const { profilePace } = require("./lib/profile-pace");

describe("profile pace", () => {
  it("measures a sole trader against expected income", () => {
    const pace = profilePace(
      { entityType: "sole_trader", driverType: "sole_trader", annualSalary: 85000, employer: "Acme Freight" },
      20000
    );
    expect(pace.situation).toBe("Sole trader");
    expect(pace.who).toBe("Sole trader · Acme Freight");
    expect(pace.targetLabel).toBe("Expected income");
    expect(pace.target).toBe(85000);
    expect(pace.actual).toBe(20000);
    expect(pace.remaining).toBe(65000);
    expect(pace.percent).toBe(23.53);
    expect(pace.barPercent).toBe(23.53);
    expect(pace.ahead).toBe(false);
    expect(pace.hasTarget).toBe(true);
  });

  it("uses annual salary for an employee and expected income for an owner-driver", () => {
    expect(profilePace({ driverType: "employee", annualSalary: 75000 }, 0).targetLabel).toBe(
      "Annual salary"
    );
    expect(profilePace({ driverType: "long_haul", annualSalary: 120000 }, 1000).situation).toBe(
      "Linehaul driver"
    );
    expect(profilePace({ driverType: "owner_driver", annualSalary: 130000 }, 0).targetLabel).toBe(
      "Expected income"
    );
  });

  it("shows when recorded income has passed the profile total", () => {
    const pace = profilePace({ entityType: "partnership", annualSalary: 85000, employer: "Hill Haulage" }, 90000);
    expect(pace.situation).toBe("Partnership");
    expect(pace.remaining).toBe(0);
    expect(pace.overBy).toBe(5000);
    expect(pace.ahead).toBe(true);
    expect(pace.percent).toBe(105.88);
    expect(pace.barPercent).toBe(100);
  });

  it("stays quiet until a profile total is set", () => {
    const pace = profilePace({ entityType: "employee", employer: "Lindsay" }, 400);
    expect(pace.hasTarget).toBe(false);
    expect(pace.percent).toBeNull();
    expect(pace.remaining).toBeNull();
    expect(pace.barPercent).toBe(0);
  });
});
