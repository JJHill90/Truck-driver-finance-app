const {
  listMenuCategories,
  listMenuCategoryGroups,
  listSpecialClaimCategories,
  normalizeExpenseCategoryId,
  COMBINED_MEALS_CAP,
  ensureMealsRegistered,
  HIDDEN_FROM_MENU,
  LABEL_OVERRIDES,
  MEDICAL_GROUP,
  CAR_CLAIM_CATEGORY_IDS,
  CAR_CLAIM_LABEL_OVERRIDES,
} = require("./lib/expense-menu");
const { calcExpenseDeduction } = require("./lib/tax-calculator");
const { TRUCK_DRIVER_MEALS } = require("./lib/ato-standards");

describe("expense menu", () => {
  beforeAll(() => {
    ensureMealsRegistered();
  });

  it("shows Hub truck categories and hides car cents/km plus medical equipment", () => {
    const ids = listMenuCategories().map((c) => c.id);
    for (const id of HIDDEN_FROM_MENU) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("vehicle_car");
    expect(ids).not.toContain("compulsory_assessment");
    expect(ids).toContain("fuel");
    expect(ids).toContain("tyres");
    expect(ids).toContain("repairs_maintenance");
    expect(ids).toContain("parking_tolls");
    expect(ids).toContain("registration_insurance");
    const byId = Object.fromEntries(listMenuCategories().map((c) => [c.id, c.label]));
    expect(byId.fuel).toBe("Truck fuel & AdBlue");
    expect(byId.fuel).not.toMatch(/work car/i);
    expect(byId.parking_tolls).toBe("Tolls & road user charges");
    expect(byId.repairs_maintenance).toBe("Repairs & maintenance");
    expect(listMenuCategoryGroups()).toContain("Vehicle & fuel");
  });

  it("exposes ATO car-related categories for Car Expenses/Claims", () => {
    const car = listSpecialClaimCategories();
    expect(car.map((c) => c.id)).toEqual(CAR_CLAIM_CATEGORY_IDS);
    expect(car.every((c) => c.group === "Car expenses (ATO work-related)")).toBe(true);
    expect(car.find((c) => c.id === "vehicle_car").label).toBe(
      CAR_CLAIM_LABEL_OVERRIDES.vehicle_car
    );
    expect(car.find((c) => c.id === "parking_tolls").label).toBe(
      CAR_CLAIM_LABEL_OVERRIDES.parking_tolls
    );
    // Laundry and meals stay on the general menu, not car claims.
    expect(car.map((c) => c.id)).not.toContain("laundry");
    expect(car.map((c) => c.id)).not.toContain("meals");
    expect(car.map((c) => c.id)).not.toContain("vehicle_truck");
  });

  it("keeps car claims independent from the general expense menu", () => {
    const menuIds = listMenuCategories().map((c) => c.id);
    const carIds = listSpecialClaimCategories().map((c) => c.id);
    expect(carIds).not.toEqual(menuIds);
    expect(menuIds).toContain("meals");
    expect(menuIds).toContain("laundry");
    expect(menuIds).not.toContain("vehicle_car");
    expect(menuIds).toContain("fuel");
    expect(carIds).toContain("vehicle_car");
  });

  it("exposes Food/Meals plus breakfast, lunch and dinner", () => {
    const ids = listMenuCategories().map((c) => c.id);
    expect(ids).toContain("meals");
    expect(ids).toContain("meals_breakfast");
    expect(ids).toContain("meals_lunch");
    expect(ids).toContain("meals_dinner");
    const meals = listMenuCategories().find((c) => c.id === "meals");
    expect(meals.label).toBe("Overnight travel meals");
    const expected =
      TRUCK_DRIVER_MEALS.breakfast.cap +
      TRUCK_DRIVER_MEALS.lunch.cap +
      TRUCK_DRIVER_MEALS.dinner.cap;
    expect(meals.cap).toBeCloseTo(expected, 2);
    expect(COMBINED_MEALS_CAP).toBeCloseTo(expected, 2);
  });

  it("does not put Suite medical equipment on the Hub menu", () => {
    expect(listMenuCategories().some((c) => c.id === "compulsory_assessment")).toBe(false);
    expect(listMenuCategoryGroups()).not.toContain(MEDICAL_GROUP);
    const byId = Object.fromEntries(listMenuCategories().map((c) => [c.id, c.label]));
    expect(byId.cleaning_supplies).toBe(LABEL_OVERRIDES.cleaning_supplies);
    expect(byId.office_admin).toBe(LABEL_OVERRIDES.office_admin);
  });

  it("keeps breakfast/lunch/dinner ids when saving", () => {
    expect(normalizeExpenseCategoryId("meals_breakfast")).toBe("meals_breakfast");
    expect(normalizeExpenseCategoryId("meals_lunch")).toBe("meals_lunch");
    expect(normalizeExpenseCategoryId("meals_dinner")).toBe("meals_dinner");
    expect(normalizeExpenseCategoryId("meals")).toBe("meals");
    expect(normalizeExpenseCategoryId("fuel")).toBe("fuel");
  });

  it("applies the combined meals cap in tax calculation", () => {
    const r = calcExpenseDeduction({ category: "meals", amount: COMBINED_MEALS_CAP + 50 });
    expect(r.deductibleAmount).toBeCloseTo(COMBINED_MEALS_CAP, 2);
  });
});
