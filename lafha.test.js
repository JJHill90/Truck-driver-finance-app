const {
  truckDriverMealsDaily,
  summariseLafha,
  collectPaidLafha,
  resolveAnnualSalary,
  bandDailyTravelTotal,
} = require("./lib/lafha");

describe("lafha", () => {
  it("uses TD 2025/4 truck-driver meal stack $128/day for 2025-26", () => {
    expect(truckDriverMealsDaily("2025-26")).toBe(128);
  });

  it("uses TD 2026/4 truck-driver meal stack $132.50/day for 2026-27+", () => {
    expect(truckDriverMealsDaily("2026-27")).toBe(132.5);
    expect(truckDriverMealsDaily("2027-28")).toBe(132.5);
  });

  it("resolves salary from profile first", () => {
    const r = resolveAnnualSalary({ annualSalary: 90000 }, []);
    expect(r).toEqual({ amount: 90000, source: "profile" });
  });

  it("estimates salary from payslips when profile empty", () => {
    const r = resolveAnnualSalary({}, [
      { documentKind: "payslip", grossTotal: 2000, reference: "week ending", date: "2026-08-01" },
    ]);
    expect(r.source).toBe("payslips");
    expect(r.amount).toBeCloseTo((2000 / 7) * 365, 0);
  });

  it("detects travel / LAFHA lines on income", () => {
    const paid = collectPaidLafha([
      {
        id: "1",
        type: "allowance_travel",
        amount: 400,
        description: "Travel Allowance",
        reference: "7 day week",
        date: "2026-08-01",
      },
      { id: "2", type: "salary_wages", amount: 2000, description: "Wages" },
    ]);
    expect(paid.entryCount).toBe(1);
    expect(paid.totalPaid).toBe(400);
    expect(paid.avgPerDay).toBeCloseTo(400 / 7, 2);
  });

  it("summariseLafha is FY-aware (TD + meal total)", () => {
    const s25 = summariseLafha({ annualSalary: 85000, driverType: "long_haul" }, [], "2025-26");
    expect(s25.salaryBand).toBe("band1");
    expect(s25.reasonablePerDay).toBe(128);
    expect(s25.determination).toBe("TD 2025/4");
    expect(s25.financialYear).toBe("2025-26");
    expect(s25.generalTravelPerDay).toBe(290.25);

    const s26 = summariseLafha({ annualSalary: 85000, driverType: "long_haul" }, [], "2026-27");
    expect(s26.reasonablePerDay).toBe(132.5);
    expect(s26.determination).toBe("TD 2026/4");
    expect(s26.overtimeMealCap).toBe(40);
    expect(s26.generalTravelPerDay).toBe(bandDailyTravelTotal("band1", "2026-27"));
    expect(s26.generalTravelPerDay).toBe(298.9);
  });

  it("uses updated salary band thresholds in 2026-27", () => {
    // Under TD 2025/4, $150k is band2; under TD 2026/4 band1 goes to $153,210.
    const s25 = summariseLafha({ annualSalary: 150000 }, [], "2025-26");
    const s26 = summariseLafha({ annualSalary: 150000 }, [], "2026-27");
    expect(s25.salaryBand).toBe("band2");
    expect(s26.salaryBand).toBe("band1");
  });
});
