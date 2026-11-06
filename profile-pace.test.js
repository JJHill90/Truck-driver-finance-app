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

  it("puts the person's name on the pace line", () => {
    const pace = profilePace(
      { name: "Alex Harris", driverType: "long_haul", employer: "Lindsay Transport", annualSalary: 110000 },
      30000
    );
    expect(pace.name).toBe("Alex");
    expect(pace.who).toBe("Alex · Linehaul driver · Lindsay Transport");
  });

  it("introduces a driver from the fields they typed", () => {
    const { profilePortrait } = require("./lib/profile-pace");
    const portrait = profilePortrait(
      {
        name: "Alex Harris",
        driverType: "long_haul",
        employer: "Lindsay Transport",
        annualSalary: 110000,
        licenceClass: "mc",
        workCombination: "b_double",
        tfnSupplied: true,
      },
      { suite: false }
    );
    expect(portrait.heading).toBe("Alex, this profile is yours.");
    expect(portrait.paragraphs[0]).toBe("Linehaul driver at Lindsay Transport.");
    expect(portrait.paragraphs[1]).toBe(
      "MC licence, B-double. This year is measured against $110,000.00 annual salary."
    );
    expect(portrait.paragraphs).toContain("TFN is marked as supplied.");
  });

  it("introduces a sole trader with occupation, GST and ABN", () => {
    const { profilePortrait } = require("./lib/profile-pace");
    const portrait = profilePortrait(
      {
        name: "Sam Lee",
        entityType: "sole_trader",
        driverType: "sole_trader",
        employer: "Acme Freight",
        occupation: "Financial auditor",
        annualSalary: 88000,
        gstRegistered: true,
        abn: "51824753556",
        travelsForWork: true,
        overnightAllowance: true,
      },
      { suite: true }
    );
    expect(portrait.heading).toBe("Sam, this profile is yours.");
    expect(portrait.paragraphs).toContain("Sole trader at Acme Freight.");
    expect(portrait.paragraphs).toContain("Occupation is Financial auditor.");
    expect(portrait.paragraphs).toContain(
      "This year is measured against $88,000.00 expected income."
    );
    expect(portrait.paragraphs).toContain("GST registered. ABN 51 824 753 556.");
    expect(portrait.paragraphs).toContain("Travel for work includes overnight stays.");
  });

  it("states a partnership share", () => {
    const { profilePortrait } = require("./lib/profile-pace");
    const portrait = profilePortrait(
      {
        name: "Jordan",
        entityType: "partnership",
        employer: "North Haul",
        partnershipName: "North Haul",
        partnerSharePercent: 40,
        annualSalary: 90000,
      },
      { suite: true }
    );
    expect(portrait.paragraphs).toContain("Your share is 40% of North Haul.");
    expect(portrait.paragraphs.join(" ")).toMatch(/expected income/);
  });

  it("invites a blank profile to be filled in", () => {
    const { profilePortrait } = require("./lib/profile-pace");
    expect(profilePortrait({}, { suite: false }).heading).toBe("This profile is yours.");
    expect(profilePortrait({}, { suite: false }).paragraphs[0]).toMatch(/Add your name, employer and salary/);
    expect(profilePortrait({}, { suite: true }).paragraphs[0]).toMatch(/registration and expected income/);
  });

  it("confirms each saved Suite field on its own", () => {
    const { profileFieldConfirmations } = require("./lib/profile-pace");
    const lines = profileFieldConfirmations(
      {
        name: "Joshua",
        entityType: "employee",
        driverType: "employee",
        employer: "Quiktrak Asia Pacific",
        occupation: "Inventory auditor",
        annualSalary: 100000,
        abn: "50551674682",
        gstRegistered: true,
        travelsForWork: true,
        tfnSupplied: true,
        financialYear: "2025-26",
      },
      { suite: true }
    );
    expect(lines.map((line) => line.text)).toEqual([
      "Joshua is active on your profile.",
      "Employee (PAYG) is active on your profile.",
      "Quiktrak Asia Pacific is active on your profile.",
      "Inventory auditor is active on your profile.",
      "$100,000.00 annual salary is active on your profile.",
      "ABN 50 551 674 682 is active on your profile.",
      "GST registered is active on your profile.",
      "Travel for work is active on your profile.",
      "Financial year 2025-26 is active on your profile.",
      "TFN supplied is active on your profile.",
    ]);
  });

  it("confirms a saved driver licence and vehicle, and skips unticked choices", () => {
    const { profileFieldConfirmations } = require("./lib/profile-pace");
    const lines = profileFieldConfirmations(
      {
        name: "Alex Harris",
        driverType: "long_haul",
        employer: "Lindsay Transport",
        annualSalary: 110000,
        licenceClass: "mc",
        workCombination: "b_double",
        gstRegistered: true,
        occupation: "Inventory auditor",
      },
      { suite: false }
    );
    const text = lines.map((line) => line.text).join("\n");
    expect(text).toMatch(/Alex Harris is active on your profile/);
    expect(text).toMatch(/Linehaul driver is active on your profile/);
    expect(text).toMatch(/MC licence is active on your profile/);
    expect(text).toMatch(/B-double is active on your profile/);
    expect(text).not.toMatch(/GST/);
    expect(text).not.toMatch(/Inventory auditor/);
    expect(text).not.toMatch(/TFN/);
  });

  it("stays quiet until a profile total is set", () => {
    const pace = profilePace({ entityType: "employee", employer: "Lindsay" }, 400);
    expect(pace.hasTarget).toBe(false);
    expect(pace.percent).toBeNull();
    expect(pace.remaining).toBeNull();
    expect(pace.barPercent).toBe(0);
  });
});
