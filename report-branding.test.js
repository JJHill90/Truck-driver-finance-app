const { decorateAccountantReport, EOFY_REPORT_TITLE } = require("./lib/report-branding");
const { driverTypeLabel } = require("./lib/driver-role-defaults");

describe("report branding — Linehaul Driver", () => {
  it("replaces Line Haulage / Long-haul wording on the EOFY title", () => {
    const report = decorateAccountantReport({
      title: "Line Haulage Driver – Performance & Tax Summary",
      driver: { name: "Sam", driverType: "long_haul", employer: "Haul Co" },
      summary: { financialYear: "2025-26" },
    });
    expect(report.title).toBe(EOFY_REPORT_TITLE);
    expect(report.title).toMatch(/Linehaul Driver/i);
    expect(report.title).not.toMatch(/Long.?[Hh]aul|Line Haulage/i);
    expect(report.driver.driverTypeLabel).toBe("Linehaul driver");
    expect(driverTypeLabel("long_haul")).toBe("Linehaul driver");
  });
});
