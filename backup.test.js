const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  setDataDirForTests,
  createBackup,
  listBackups,
  pruneLocalBackups,
  getBackupFile,
  restoreBackup,
  getStatus,
  stopBackupScheduler,
} = require("./lib/backup");

describe("data backups", () => {
  let tmp;
  let prevKeep;

  beforeEach(() => {
    stopBackupScheduler();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "haulage-backup-"));
    setDataDirForTests(tmp);
    prevKeep = process.env.BACKUP_KEEP;
    process.env.BACKUP_KEEP = "3";
    delete process.env.BACKUP_OFFSITE_DIR;
    delete process.env.BACKUP_S3_BUCKET;

    fs.mkdirSync(path.join(tmp, "users"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "receipts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "users.json"),
      JSON.stringify({ users: { dave: { username: "dave" } } }, null, 2)
    );
    fs.writeFileSync(
      path.join(tmp, "users", "dave.json"),
      JSON.stringify(
        {
          profile: { name: "Dave" },
          expenses: [{ id: "e1", amount: 12.5 }],
          income: [],
          receipts: [],
          vendors: [],
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(tmp, "receipts", "abc123.txt"), "receipt-bytes");
  });

  afterEach(() => {
    setDataDirForTests(null);
    if (prevKeep == null) delete process.env.BACKUP_KEEP;
    else process.env.BACKUP_KEEP = prevKeep;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates a tar.gz that includes accounts, records and receipts", async () => {
    const result = await createBackup({ reason: "test", actor: "vitest" });
    expect(result.id).toMatch(/^haulage-backup-/);
    expect(result.bytes).toBeGreaterThan(50);
    expect(result.sha256).toHaveLength(64);
    expect(fs.existsSync(result.localPath)).toBe(true);

    const listed = listBackups();
    expect(listed.some((b) => b.id === result.id)).toBe(true);

    const file = getBackupFile(result.id);
    expect(file.bytes).toBe(result.bytes);
  });

  it("copies to BACKUP_OFFSITE_DIR when configured", async () => {
    const offsite = path.join(tmp, "offsite");
    process.env.BACKUP_OFFSITE_DIR = offsite;
    const result = await createBackup({ reason: "offsite-test" });
    expect(result.offsite.copied).toBe(true);
    expect(fs.existsSync(path.join(offsite, result.filename))).toBe(true);
  });

  it("prunes older local backups beyond BACKUP_KEEP", async () => {
    process.env.BACKUP_KEEP = "2";
    await createBackup({ reason: "a" });
    await createBackup({ reason: "b" });
    await createBackup({ reason: "c" });
    const listed = listBackups();
    expect(listed.length).toBe(2);
    const removed = pruneLocalBackups(1);
    expect(removed.length).toBe(1);
    expect(listBackups().length).toBe(1);
  });

  it("restores records from a backup after live data changes", async () => {
    const first = await createBackup({ reason: "baseline" });
    fs.writeFileSync(
      path.join(tmp, "users", "dave.json"),
      JSON.stringify(
        {
          profile: { name: "Changed" },
          expenses: [],
          income: [],
          receipts: [],
          vendors: [],
        },
        null,
        2
      )
    );

    const restored = await restoreBackup(first.id, { confirm: "RESTORE" });
    expect(restored.restored).toBe(first.id);
    expect(restored.safetyBackupId).toBeTruthy();

    const dave = JSON.parse(fs.readFileSync(path.join(tmp, "users", "dave.json"), "utf8"));
    expect(dave.profile.name).toBe("Dave");
    expect(dave.expenses).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmp, "receipts", "abc123.txt"), "utf8")).toBe(
      "receipt-bytes"
    );
  });

  it("requires RESTORE confirmation", async () => {
    const first = await createBackup({ reason: "baseline" });
    await expect(restoreBackup(first.id, { confirm: "yes" })).rejects.toMatchObject({
      code: "CONFIRM_REQUIRED",
    });
  });

  it("reports status fields", () => {
    const status = getStatus();
    expect(status.keep).toBe(3);
    expect(status.backupDir).toContain(tmp);
    expect(typeof status.enabled).toBe("boolean");
  });
});
