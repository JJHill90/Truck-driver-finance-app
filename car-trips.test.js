const {
  createTrip,
  addDestination,
  closeTrip,
  reconcileTrips,
  softDeleteTrip,
  restoreTrip,
  centsClaimPreview,
  normalizeMethod,
  METHODS,
} = require("./lib/car-trips");

describe("car trips ATO D1 helpers", () => {
  it("normalizes claim methods", () => {
    expect(normalizeMethod("Cents per Kilometre")).toBe(METHODS.CENTS);
    expect(normalizeMethod("logbook")).toBe(METHODS.LOGBOOK);
  });

  it("creates a closed cents-per-km trip with start and end", () => {
    const records = { carTrips: [], expenses: [] };
    const result = createTrip(records, {
      method: "cents_per_km",
      date: "2026-08-20",
      origin: "Home depot",
      destination: "Customer yard",
      kilometres: 42,
      purpose: "Parts pickup",
    });
    expect(result.ok).toBe(true);
    expect(result.trip.status).toBe("closed");
    expect(result.trip.origin).toBe("Home depot");
    expect(result.trip.destination).toBe("Customer yard");
    expect(result.trip.kilometres).toBe(42);
  });

  it("opens a logbook trip, adds destinations, and closes with confirm fields", () => {
    const records = { carTrips: [] };
    const created = createTrip(records, {
      method: "logbook",
      date: "2026-08-21",
      origin: "Depot",
      odometerStart: "10000",
      purpose: "Linehaul support run",
    });
    expect(created.ok).toBe(true);
    expect(created.trip.status).toBe("open");

    const mid = addDestination(records, created.trip.id, { name: "Rest stop", odometer: "10080" });
    expect(mid.ok).toBe(true);
    const end = addDestination(records, created.trip.id, { name: "Yard B", odometer: "10210" });
    expect(end.ok).toBe(true);

    const closed = closeTrip(records, created.trip.id, { kilometres: 210, odometerEnd: "10210" });
    expect(closed.ok).toBe(true);
    expect(closed.trip.status).toBe("closed");
    expect(closed.trip.origin).toBe("Depot");
    expect(closed.trip.destination).toBe("Yard B");
    expect(closed.trip.kilometres).toBe(210);
  });

  it("refuses close-out until there are enough stops", () => {
    const records = { carTrips: [] };
    const created = createTrip(records, {
      method: "logbook",
      date: "2026-08-21",
      origin: "Depot",
    });
    const closed = closeTrip(records, created.trip.id, {});
    expect(closed.ok).toBe(false);
    expect(closed.code).toBe("incomplete_trip");
  });

  it("reconciles closed trips and blocks soft-delete until unlocked", () => {
    const records = { carTrips: [] };
    const created = createTrip(records, {
      method: "cents_per_km",
      date: "2026-08-22",
      origin: "A",
      destination: "B",
      kilometres: 10,
    });
    const rec = reconcileTrips(records, [created.trip.id], { username: "admin" });
    expect(rec.updated).toHaveLength(1);
    expect(created.trip.reconciled).toBe(true);
    const del = softDeleteTrip(records, created.trip.id, { username: "driver" });
    expect(del.ok).toBe(false);
    expect(del.code).toBe("reconciled");
    const forced = softDeleteTrip(records, created.trip.id, { username: "admin", force: true });
    expect(forced.ok).toBe(true);
    const restored = restoreTrip(records, created.trip.id, { username: "admin" });
    expect(restored.ok).toBe(true);
    expect(restored.trip.deletedAt).toBeNull();
  });

  it("previews FY cents claim with 5,000 km cap", () => {
    const records = { carTrips: [] };
    createTrip(records, {
      method: "cents_per_km",
      date: "2026-03-01",
      origin: "A",
      destination: "B",
      kilometres: 4800,
    });
    createTrip(records, {
      method: "cents_per_km",
      date: "2026-04-01",
      origin: "C",
      destination: "D",
      kilometres: 400,
    });
    const preview = centsClaimPreview(records, "2025-26");
    expect(preview.kilometres).toBe(5200);
    expect(preview.claimableKilometres).toBe(5000);
    expect(preview.overCap).toBe(true);
    expect(preview.estimatedDeduction).toBeGreaterThan(0);
  });
});
