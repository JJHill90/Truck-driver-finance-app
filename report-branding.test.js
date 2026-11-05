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

  it("copies the saved profile onto the EOFY driver block", () => {
    const report = decorateAccountantReport(
      {
        title: "Line Haulage Driver – Performance & Tax Summary",
        driver: { driverType: "local" },
        summary: { financialYear: "2025-26" },
      },
      {
        name: "Alex Harris",
        employer: "Lindsay Transport",
        driverType: "local",
        annualSalary: 72000,
        licenceClass: "hr",
        workCombination: "rigid",
        tfnSupplied: true,
      }
    );
    expect(report.driver.name).toBe("Alex Harris");
    expect(report.driver.employer).toBe("Lindsay Transport");
    expect(report.driver.driverTypeLabel).toBe("Local driver");
    expect(report.driver.annualSalary).toBe(72000);
    expect(report.driver.licenceClass).toBe("hr");
    expect(report.driver.workCombination).toBe("rigid");
    expect(report.driver.tfnSupplied).toBe(true);
  });
});
