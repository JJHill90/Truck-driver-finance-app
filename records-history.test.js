const fs = require("fs");
const history = require("./lib/records-history");

describe("records-history", () => {
  it("snapshots, lists, and restores records", () => {
    const username = `test_hist_${Date.now()}`;
    const dir = history.historyDirFor(username);
    try {
      const v1 = {
        profile: { name: "Ada", financialYear: "2025-26", annualSalary: 90000 },
        expenses: [{ id: "e1", amount: 10 }],
        income: [],
        receipts: [],
      };
      const snap1 = history.snapshotRecords(username, v1, {
        reason: "test",
        actor: "Haulage_Admin",
      });
      expect(snap1.skipped).toBe(false);

      const skip = history.snapshotRecords(username, v1, { reason: "test" });
      expect(skip.skipped).toBe(true);

      const v2 = {
        ...v1,
        expenses: [
          { id: "e1", amount: 10 },
          { id: "e2", amount: 99 },
        ],
      };
      const snap2 = history.snapshotRecords(username, v2, { reason: "edit" });
      expect(snap2.skipped).toBe(false);

      const list = history.listSnapshots(username);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list[0].counts.expenses).toBe(2);

      const loaded = history.loadSnapshotRecords(username, snap1.id);
      expect(loaded.records.expenses).toHaveLength(1);
      expect(loaded.records.profile.name).toBe("Ada");
      expect(loaded.meta.actor).toBe("Haulage_Admin");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
