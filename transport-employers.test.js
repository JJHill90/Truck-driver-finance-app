const {
  searchTransportEmployers,
  listTransportEmployers,
} = require("./lib/transport-employers");
const {
  getDriverRoleDefaults,
  listDriverRoleDefaults,
  presentDriverTypes,
} = require("./lib/driver-role-defaults");

describe("searchTransportEmployers", () => {
  it("finds Lindsay Brothers via keyword lindsay", () => {
    const hits = searchTransportEmployers("lindsay");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name.toLowerCase()).toContain("lindsay");
  });

  it("ranks exact-ish alias matches highly for Toll", () => {
    const hits = searchTransportEmployers("toll");
    expect(hits.some((h) => /toll/i.test(h.name))).toBe(true);
  });

  it("returns nothing for tiny queries", () => {
    expect(searchTransportEmployers("l")).toEqual([]);
    expect(searchTransportEmployers("")).toEqual([]);
  });

  it("exposes a non-empty curated directory", () => {
    expect(listTransportEmployers().length).toBeGreaterThan(20);
  });
});

describe("driver role defaults", () => {
  it("maps each driver type to salary and a matching licence class", () => {
    const rows = listDriverRoleDefaults();
    expect(rows.map((r) => r.id).sort()).toEqual(
      ["local", "long_haul", "owner_driver", "short_haul"].sort()
    );
    for (const row of rows) {
      expect(row.annualSalary).toBeGreaterThan(50000);
      expect(row.licenceClass).toMatch(/^(lr_mr|hr|hc|mc)$/);
    }
  });

  it("sets linehaul (long_haul id) to MC band salary", () => {
    const d = getDriverRoleDefaults("long_haul");
    expect(d.annualSalary).toBe(120000);
    expect(d.licenceClass).toBe("mc");
    expect(d.label).toBe("Linehaul driver");
  });

  it("sets local to HR band salary", () => {
    const d = getDriverRoleDefaults("local");
    expect(d.annualSalary).toBe(72000);
    expect(d.licenceClass).toBe("hr");
  });

  it("returns null for unknown types", () => {
    expect(getDriverRoleDefaults("pilot")).toBeNull();
  });

  it("presents long_haul as Linehaul driver for the Profile select", () => {
    const types = presentDriverTypes();
    expect(types.long_haul.label).toBe("Linehaul driver");
    expect(types.local.label).toBe("Local driver");
  });
});
