const tour = require("./lib/first-run-tour");

describe("first-run tour", () => {
  it("flags self-register and admin-created profiles as pending", () => {
    const self = tour.applyOnSelfRegister({ username: "alex" });
    expect(self.firstRunTour).toBe("pending");
    expect(tour.isPending(self)).toBe(true);
    const made = tour.applyOnAdminCreate({ username: "sam" });
    expect(made.firstRunTour).toBe("pending");
    expect(tour.isPending(made)).toBe(true);
  });

  it("does not tour admins or existing users with no first-run flag", () => {
    expect(tour.isPending({ isAdmin: true, firstRunTour: "pending" })).toBe(false);
    expect(tour.isPending({ username: "old" })).toBe(false);
    expect(tour.isPending({ needsFirstRunTour: true })).toBe(true);
    expect(tour.isPending({ firstRunTour: "done" })).toBe(true);
    expect(tour.isPending({ firstRunTour: "done", firstRunTourCompletedAt: "2026-10-01T00:00:00Z" })).toBe(
      false
    );
  });

  it("starts on first tax-hub open, resumes an in-session tour, and ignores Fuel Hub", () => {
    expect(tour.shouldStart({ needsFirstRunTour: true, fuelhubOpen: false, authLocked: false })).toBe(true);
    expect(tour.shouldStart({ needsFirstRunTour: false, sessionActive: true })).toBe(true);
    expect(tour.shouldStart({ needsFirstRunTour: true, fuelhubOpen: true })).toBe(false);
    expect(tour.shouldStart({ needsFirstRunTour: true, authLocked: true })).toBe(false);
    expect(tour.shouldStart({ needsFirstRunTour: false, sessionActive: false })).toBe(false);
  });

  it("walks dashboard → expenses (scan, confirm, reconcile) → income → report → car last", () => {
    const steps = tour.listSteps({ product: "suite" });
    const views = steps.map((s) => s.view);
    expect(views[0]).toBe("dashboard");
    expect(views.includes("expenses")).toBe(true);
    expect(views.includes("income")).toBe(true);
    expect(views.includes("report")).toBe(true);
    expect(views.slice(-1)[0]).toBe("car-expenses");
    expect(views.indexOf("expenses")).toBeLessThan(views.indexOf("income"));
    expect(views.indexOf("income")).toBeLessThan(views.indexOf("report"));
    expect(views.indexOf("report")).toBeLessThan(views.indexOf("car-expenses"));
    expect(steps.some((s) => s.prepare === "open-guide")).toBe(true);
    expect(steps.some((s) => s.prepare === "show-scan-confirm")).toBe(true);
    expect(steps.some((s) => s.prepare === "show-income-confirm")).toBe(true);
    expect(steps.filter((s) => s.prepare === "show-reconcile").map((s) => s.view)).toEqual([
      "expenses",
      "income",
    ]);
    expect(steps.some((s) => s.id === "rep-export")).toBe(true);
    expect(steps.some((s) => s.id === "dash-nights")).toBe(true);
    expect(steps.find((s) => s.id === "exp-confirm").target).toBe("#scan-result");
    expect(steps.filter((s) => s.press).map((s) => s.id)).toEqual([
      "dash-welcome",
      "exp-nav",
      "exp-confirm",
      "exp-ledger",
      "inc-nav",
      "inc-confirm",
      "inc-ledger",
      "rep-nav",
      "car-nav",
    ]);
    expect(tour.listSteps({ product: "haulage" })[0].title).toMatch(/Taxation Hub/);
    expect(steps[0].title).toMatch(/Go Taxation Suite/);
    expect(steps.every((s) => String(s.body || "").length <= 160)).toBe(true);
    expect(steps.every((s) => !/\bskip\b/i.test(s.body))).toBe(true);
  });

  it("marks the tour done so a later login does not show it", () => {
    const user = tour.markDone({ firstRunTour: "pending" });
    expect(user.firstRunTour).toBe("done");
    expect(user.firstRunTourCompletedAt).toBeTruthy();
    expect(tour.isPending(user)).toBe(false);
  });
});
