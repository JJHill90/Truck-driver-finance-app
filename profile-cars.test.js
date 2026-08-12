const {
  MAX_CARS,
  ATO_D1_EXAMPLE_WORK_USE_PERCENT,
  normalizeCar,
  normalizeCars,
  formatCarLine,
  compileActiveCarsText,
  activeCars,
  primaryActiveWorkUsePercent,
  clampWorkUsePercent,
  atoWorkUseGuidance,
} = require("./lib/profile-cars");

describe("profile-cars", () => {
  it("exposes the ATO D1 illustrative work-use example (63%)", () => {
    expect(ATO_D1_EXAMPLE_WORK_USE_PERCENT).toBe(63);
    const guide = atoWorkUseGuidance();
    expect(guide.examplePercent).toBe(63);
    expect(guide.note).toMatch(/4,100/);
    expect(guide.source).toMatch(/D1/);
  });

  it("normalizes make, model, rego, engine, odometer and work use", () => {
    const car = normalizeCar(
      {
        make: "  Toyota ",
        model: "Hilux",
        registration: "abc123",
        engineSize: "2.8 L",
        odometerReading: "142,350 km",
        estimatedWorkUsePercent: 55,
        active: true,
      },
      { now: "2026-08-12T00:00:00.000Z" }
    );
    expect(car.make).toBe("Toyota");
    expect(car.model).toBe("Hilux");
    expect(car.registration).toBe("ABC123");
    expect(car.engineSize).toBe("2.8 L");
    expect(car.odometerReading).toBe("142,350 km");
    expect(car.estimatedWorkUsePercent).toBe(55);
    expect(car.active).toBe(true);
    expect(formatCarLine(car)).toMatch(/Odometer 142,350 km/);
    expect(formatCarLine(car)).toMatch(/Work use 55%/);
  });

  it("defaults missing work-use % to the ATO D1 example", () => {
    const car = normalizeCar({ make: "Ford", model: "Ranger", active: true });
    expect(car.estimatedWorkUsePercent).toBe(63);
    expect(clampWorkUsePercent(120)).toBe(100);
    expect(clampWorkUsePercent(-5)).toBe(0);
  });

  it("drops empty cars and caps the list", () => {
    const many = Array.from({ length: MAX_CARS + 3 }, (_, i) => ({
      make: `Make${i}`,
      model: `M${i}`,
      active: i % 2 === 0,
    }));
    const list = normalizeCars([{ make: "" }, ...many, null]);
    expect(list).toHaveLength(MAX_CARS);
    expect(list.every((c) => c.make)).toBe(true);
  });

  it("compiles active cars and resolves primary work-use %", () => {
    const cars = normalizeCars([
      {
        make: "Ford",
        model: "Ranger",
        registration: "XYZ99",
        engineSize: "2.0 L",
        odometerReading: "90,000 km",
        estimatedWorkUsePercent: 40,
        active: true,
      },
      { make: "Old", model: "Car", registration: "OLD1", active: false },
      {
        make: "Toyota",
        model: "Camry",
        registration: "CAM01",
        estimatedWorkUsePercent: 70,
        active: true,
      },
    ]);
    expect(activeCars(cars)).toHaveLength(2);
    expect(primaryActiveWorkUsePercent(cars)).toBe(40);
    const text = compileActiveCarsText(cars);
    expect(text).toMatch(/Ford Ranger/);
    expect(text).toMatch(/Odometer 90,000 km/);
    expect(text).toMatch(/Work use 40%/);
    expect(text).not.toMatch(/OLD1/);
  });

  it("explains when no active cars are on file", () => {
    expect(compileActiveCarsText([])).toMatch(/No active work cars/);
    expect(compileActiveCarsText([{ make: "Ford", active: false }])).toMatch(/No active work cars/);
    expect(primaryActiveWorkUsePercent([])).toBeNull();
  });
});
