const {
  listMenuCategories,
  normalizeExpenseCategoryId,
  COMBINED_MEALS_CAP,
  ensureMealsRegistered,
  HIDDEN_FROM_MENU,
} = require("./lib/expense-menu");
const { calcExpenseDeduction } = require("./lib/tax-calculator");
const { TRUCK_DRIVER_MEALS } = require("./lib/ato-standards");

describe("expense menu", () => {
  beforeAll(() => {
    ensureMealsRegistered();
  });

  it("hides snacks, split meals, AdBlue and truck cabin from the menu", () => {
    const ids = listMenuCategories().map((c) => c.id);
    for (const id of HIDDEN_FROM_MENU) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("meals_breakfast");
    expect(ids).not.toContain("meals_lunch");
    expect(ids).not.toContain("meals_dinner");
  });

  it("exposes a single Meals category with combined ATO cap", () => {
    const meals = listMenuCategories().find((c) => c.id === "meals");
    expect(meals).toBeTruthy();
    expect(meals.label).toBe("Meals");
    const expected =
      TRUCK_DRIVER_MEALS.breakfast.cap +
      TRUCK_DRIVER_MEALS.lunch.cap +
      TRUCK_DRIVER_MEALS.dinner.cap;
    expect(meals.cap).toBeCloseTo(expected, 2);
    expect(COMBINED_MEALS_CAP).toBeCloseTo(expected, 2);
  });

  it("maps legacy meal ids onto meals", () => {
    expect(normalizeExpenseCategoryId("meals_breakfast")).toBe("meals");
    expect(normalizeExpenseCategoryId("meals_lunch")).toBe("meals");
    expect(normalizeExpenseCategoryId("meals_dinner")).toBe("meals");
    expect(normalizeExpenseCategoryId("fuel")).toBe("fuel");
  });

  it("applies the combined meals cap in tax calculation", () => {
    const r = calcExpenseDeduction({ category: "meals", amount: COMBINED_MEALS_CAP + 50 });
    expect(r.deductibleAmount).toBeCloseTo(COMBINED_MEALS_CAP, 2);
  });
});
