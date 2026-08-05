const {
  truckDriverMealsDaily,
  summariseLafha,
  collectPaidLafha,
  resolveAnnualSalary,
} = require("./lib/lafha");

describe("lafha", () => {
  it("uses truck-driver meal stack $128/day", () => {
    expect(truckDriverMealsDaily()).toBe(128);
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

  it("summariseLafha includes band and reasonable rate", () => {
    const s = summariseLafha({ annualSalary: 85000, driverType: "long_haul" }, []);
    expect(s.salaryBand).toBe("band1");
    expect(s.reasonablePerDay).toBe(128);
    // Domestic travel table (accom + meals + incidentals) — not the OT+meals stack.
    expect(s.generalTravelPerDay).toBe(290.25);
  });
});
