const {
  listMenuIncomeTypes,
  normalizeIncomeTypeId,
  HIDDEN_FROM_INCOME_MENU,
  DEFAULT_INCOME_TYPE,
} = require("./lib/income-menu");

describe("income menu", () => {
  it("hides taxable and overtime meal allowances but keeps travel/LAFHA", () => {
    const ids = listMenuIncomeTypes().map((t) => t.id);
    for (const id of HIDDEN_FROM_INCOME_MENU) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("allowance_taxable");
    expect(ids).not.toContain("allowance_overtime_meal");
    expect(ids).toContain("allowance_travel");
    expect(ids).toContain("salary_wages");
    expect(ids).toContain("remittance_owner");
    const travel = listMenuIncomeTypes().find((t) => t.id === "allowance_travel");
    expect(travel.label).toMatch(/Living Away from Home/i);
  });

  it("maps only still-hidden allowance types onto salary_wages", () => {
    expect(normalizeIncomeTypeId("allowance_taxable")).toBe(DEFAULT_INCOME_TYPE);
    expect(normalizeIncomeTypeId("allowance_overtime_meal")).toBe(DEFAULT_INCOME_TYPE);
    expect(normalizeIncomeTypeId("allowance_travel")).toBe("allowance_travel");
    expect(normalizeIncomeTypeId("salary_wages")).toBe("salary_wages");
    expect(normalizeIncomeTypeId("remittance_owner")).toBe("remittance_owner");
  });
});
