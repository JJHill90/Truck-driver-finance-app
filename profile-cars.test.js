const {
  MAX_CARS,
  normalizeCar,
  normalizeCars,
  formatCarLine,
  compileActiveCarsText,
  activeCars,
} = require("./lib/profile-cars");

describe("profile-cars", () => {
  it("normalizes make, model, rego and engine size", () => {
    const car = normalizeCar(
      {
        make: "  Toyota ",
        model: "Hilux",
        registration: "abc123",
        engineSize: "2.8 L",
        active: true,
      },
      { now: "2026-08-12T00:00:00.000Z" }
    );
    expect(car.make).toBe("Toyota");
    expect(car.model).toBe("Hilux");
    expect(car.registration).toBe("ABC123");
    expect(car.engineSize).toBe("2.8 L");
    expect(car.active).toBe(true);
    expect(car.id).toBeTruthy();
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

  it("compiles active cars into a plain-text ATO block", () => {
    const cars = normalizeCars([
      { make: "Ford", model: "Ranger", registration: "XYZ99", engineSize: "2.0 L", active: true },
      { make: "Old", model: "Car", registration: "OLD1", active: false },
      { make: "Toyota", model: "Camry", registration: "CAM01", engineSize: "2.5 L", active: true },
    ]);
    expect(activeCars(cars)).toHaveLength(2);
    expect(formatCarLine(cars[0])).toMatch(/Ford Ranger/);
    const text = compileActiveCarsText(cars);
    expect(text).toMatch(/Active work vehicle/);
    expect(text).toMatch(/Ford Ranger/);
    expect(text).toMatch(/Rego XYZ99/);
    expect(text).toMatch(/Toyota Camry/);
    expect(text).not.toMatch(/OLD1/);
  });

  it("explains when no active cars are on file", () => {
    expect(compileActiveCarsText([])).toMatch(/No active work cars/);
    expect(compileActiveCarsText([{ make: "Ford", active: false }])).toMatch(/No active work cars/);
  });
});
