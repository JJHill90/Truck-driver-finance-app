const {
  getLicenceClassForSalary,
  normalizeLicenceClassId,
  listLicenceClasses,
  getLicenceClassMeta,
} = require("./lib/licence-class");

describe("getLicenceClassForSalary", () => {
  it("maps dollar thresholds to LR/MR, HR, HC, MC", () => {
    expect(getLicenceClassForSalary(58000)).toBe("lr_mr");
    expect(getLicenceClassForSalary(69999)).toBe("lr_mr");
    expect(getLicenceClassForSalary(70000)).toBe("hr");
    expect(getLicenceClassForSalary(75000)).toBe("hr");
    expect(getLicenceClassForSalary(79000)).toBe("hc");
    expect(getLicenceClassForSalary(100000)).toBe("hc");
    expect(getLicenceClassForSalary(110000)).toBe("mc");
    expect(getLicenceClassForSalary(160000)).toBe("mc");
    expect(getLicenceClassForSalary(220000)).toBe("mc");
  });

  it("defaults empty or invalid salary to LR/MR", () => {
    expect(getLicenceClassForSalary(0)).toBe("lr_mr");
    expect(getLicenceClassForSalary(null)).toBe("lr_mr");
    expect(getLicenceClassForSalary("")).toBe("lr_mr");
  });
});

describe("normalizeLicenceClassId", () => {
  it("accepts canonical ids and common aliases", () => {
    expect(normalizeLicenceClassId("HC")).toBe("hc");
    expect(normalizeLicenceClassId("lr_mr")).toBe("lr_mr");
    expect(normalizeLicenceClassId("road_train")).toBe("mc");
    expect(normalizeLicenceClassId("nope")).toBeNull();
  });
});

describe("listLicenceClasses", () => {
  it("exposes four licence classes with labels", () => {
    const list = listLicenceClasses();
    expect(list.map((c) => c.id)).toEqual(["lr_mr", "hr", "hc", "mc"]);
    expect(getLicenceClassMeta("hr").shortLabel).toBe("HR");
  });
});
