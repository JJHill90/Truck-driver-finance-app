const {
  readPresets,
  applyDefaultCategory,
  applyDefaultWorkUse,
  applyExpensePresets,
  applyOcrCategoryPreset,
} = require("./lib/user-presets");

describe("user-presets", () => {
  const user = {
    username: "driver1",
    presets: { defaultWorkUsePercent: 80, defaultCategory: "meals" },
  };

  it("reads and clamps work-use %", () => {
    expect(readPresets(user).defaultWorkUsePercent).toBe(80);
    expect(readPresets(user).defaultCategory).toBe("meals");
    expect(
      readPresets({ presets: { defaultWorkUsePercent: 150 } }).defaultWorkUsePercent
    ).toBe(100);
    expect(readPresets({ presets: {} }).defaultWorkUsePercent).toBeNull();
  });

  it("applies default category only when current is weak", () => {
    const weak = { category: "other_work" };
    expect(applyDefaultCategory(weak, user)).toBe(true);
    expect(weak.category).toBe("meals");

    const strong = { category: "fuel" };
    expect(applyDefaultCategory(strong, user)).toBe(false);
    expect(strong.category).toBe("fuel");
  });

  it("applies default work-use only when missing (not when 100 is explicit)", () => {
    const missing = { category: "meals" };
    expect(applyDefaultWorkUse(missing, user)).toBe(true);
    expect(missing.workUsePercent).toBe(80);

    const explicit = { category: "meals", workUsePercent: 100 };
    expect(applyDefaultWorkUse(explicit, user)).toBe(false);
    expect(explicit.workUsePercent).toBe(100);
  });

  it("does not apply work-use preset to car claim categories", () => {
    const car = { category: "fuel", workUsePercent: undefined };
    expect(applyDefaultWorkUse(car, user)).toBe(false);
    expect(car.workUsePercent).toBeUndefined();
  });

  it("applyExpensePresets fills weak category + missing work-use", () => {
    const body = { category: "other_work", amount: 40 };
    applyExpensePresets(body, user);
    expect(body.category).toBe("meals");
    expect(body.workUsePercent).toBe(80);
  });

  it("applyOcrCategoryPreset sets suggestedCategory + source when weak", () => {
    const ocr = { suggestedCategory: "other_work" };
    applyOcrCategoryPreset(ocr, user);
    expect(ocr.suggestedCategory).toBe("meals");
    expect(ocr.categorySource).toBe("user_preset");

    const fuel = { suggestedCategory: "fuel", categorySource: "business_type" };
    applyOcrCategoryPreset(fuel, user);
    expect(fuel.suggestedCategory).toBe("fuel");
    expect(fuel.categorySource).toBe("business_type");
  });

  it("ignores empty presets", () => {
    const body = { category: "other_work" };
    applyExpensePresets(body, { presets: {} });
    expect(body.category).toBe("other_work");
    expect(body.workUsePercent).toBeUndefined();
  });
});
