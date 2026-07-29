const {
  listMenuIncomeTypes,
  normalizeIncomeTypeId,
  HIDDEN_FROM_INCOME_MENU,
  DEFAULT_INCOME_TYPE,
} = require("./lib/income-menu");

describe("income menu", () => {
  it("hides taxable, travel and overtime meal allowances from the menu", () => {
    const ids = listMenuIncomeTypes().map((t) => t.id);
    for (const id of HIDDEN_FROM_INCOME_MENU) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("allowance_taxable");
    expect(ids).not.toContain("allowance_travel");
    expect(ids).not.toContain("allowance_overtime_meal");
    expect(ids).toContain("salary_wages");
    expect(ids).toContain("remittance_owner");
  });

  it("maps hidden allowance types onto salary_wages for new entries", () => {
    expect(normalizeIncomeTypeId("allowance_taxable")).toBe(DEFAULT_INCOME_TYPE);
    expect(normalizeIncomeTypeId("allowance_travel")).toBe(DEFAULT_INCOME_TYPE);
    expect(normalizeIncomeTypeId("allowance_overtime_meal")).toBe(DEFAULT_INCOME_TYPE);
    expect(normalizeIncomeTypeId("salary_wages")).toBe("salary_wages");
    expect(normalizeIncomeTypeId("remittance_owner")).toBe("remittance_owner");
  });
});
