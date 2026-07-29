const {
  listMenuCategories,
  normalizeExpenseCategoryId,
  COMBINED_MEALS_CAP,
  ensureMealsRegistered,
  HIDDEN_FROM_MENU,
  LABEL_OVERRIDES,
} = require("./lib/expense-menu");
const { calcExpenseDeduction } = require("./lib/tax-calculator");
const { TRUCK_DRIVER_MEALS } = require("./lib/ato-standards");

describe("expense menu", () => {
  beforeAll(() => {
    ensureMealsRegistered();
  });

  it("hides snacks, split meals, AdBlue, cabin, restraints and truck maintenance", () => {
    const ids = listMenuCategories().map((c) => c.id);
    for (const id of HIDDEN_FROM_MENU) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("fuel");
    expect(ids).not.toContain("tyres");
    expect(ids).not.toContain("repairs_maintenance");
    expect(ids).not.toContain("weighbridge");
    expect(ids).not.toContain("parking_tolls");
    expect(ids).not.toContain("load_restraint");
    expect(ids).not.toContain("vehicle_truck");
  });

  it("exposes a single Food/Meals category with combined ATO cap", () => {
    const meals = listMenuCategories().find((c) => c.id === "meals");
    expect(meals).toBeTruthy();
    expect(meals.label).toBe("Food/Meals");
    const expected =
      TRUCK_DRIVER_MEALS.breakfast.cap +
      TRUCK_DRIVER_MEALS.lunch.cap +
      TRUCK_DRIVER_MEALS.dinner.cap;
    expect(meals.cap).toBeCloseTo(expected, 2);
    expect(COMBINED_MEALS_CAP).toBeCloseTo(expected, 2);
  });

  it("applies display renames for cleaning, logbook and medical", () => {
    const byId = Object.fromEntries(listMenuCategories().map((c) => [c.id, c.label]));
    expect(byId.cleaning_supplies).toBe(LABEL_OVERRIDES.cleaning_supplies);
    expect(byId.office_admin).toBe(LABEL_OVERRIDES.office_admin);
    expect(byId.compulsory_assessment).toBe(LABEL_OVERRIDES.compulsory_assessment);
    expect(byId.cleaning_supplies).toBe("Truck cleaning (truck washing)");
    expect(byId.office_admin).toBe("Logbook/Work Diary/EWD (Purchase and subscription)");
    expect(byId.compulsory_assessment).toBe("Medical equipment");
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
