const fs = require("fs");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const backup = require("./lib/backup");
const suite = require("./lib/suite");

const strongPass = "RoadSafe!99x";

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("profile data survives a new build", () => {
  let tmp;
  let prevAutorestore;

  beforeEach(() => {
    tmp = tmpDir("haulage-persist-");
    auth.setDataDirForTests(tmp);
    backup.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    prevAutorestore = process.env.BACKUP_AUTORESTORE;
    process.env.BACKUP_AUTORESTORE = "1";
    fs.mkdirSync(path.join(tmp, "users"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "suite", "users"), { recursive: true });
  });

  afterEach(() => {
    auth.setDataDirForTests(null);
    backup.setDataDirForTests(null);
    suite.setDataDirForTests(null);
    if (prevAutorestore == null) delete process.env.BACKUP_AUTORESTORE;
    else process.env.BACKUP_AUTORESTORE = prevAutorestore;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps the login session after a process restart", () => {
    const username = `keep_${Date.now().toString(36)}`;
    auth.registerUser(username, strongPass, {}, `${username}@example.com`);
    const token = auth.createSession(username);
    expect(auth.getSessionUser(token)).toBe(username);

    auth.reloadSessionsFromDisk();
    expect(auth.getSessionUser(token)).toBe(username);
  });

  it("does not overwrite a corrupt users.json with an empty store", () => {
    const usersFile = path.join(tmp, "users.json");
    const original = JSON.stringify({
      users: { alex: { username: "alex", email: "alex@example.com" } },
    });
    fs.writeFileSync(usersFile, "{not-json");
    const loaded = auth.loadUsers();
    expect(loaded.__untrusted).toBe(true);
    auth.saveUsers(loaded);
    expect(fs.readFileSync(usersFile, "utf8")).toBe("{not-json");
    fs.writeFileSync(usersFile, original);
  });

  it("copies an existing haulage ledger into a missing Suite file", () => {
    const haulageFile = path.join(tmp, "users", "pat.json");
    fs.writeFileSync(
      haulageFile,
      JSON.stringify({ profile: { name: "Pat Lee", employer: "Acme" } }, null, 2)
    );
    const dest = suite.seedRecordsIfMissing("pat", haulageFile);
    expect(fs.existsSync(dest)).toBe(true);
    const copied = JSON.parse(fs.readFileSync(dest, "utf8"));
    expect(copied.profile.name).toBe("Pat Lee");
    expect(copied.profile.employer).toBe("Acme");
    fs.writeFileSync(dest, JSON.stringify({ profile: { name: "Kept" } }, null, 2));
    suite.seedRecordsIfMissing("pat", haulageFile);
    expect(JSON.parse(fs.readFileSync(dest, "utf8")).profile.name).toBe("Kept");
  });

  it("restores accounts and Suite records from the latest backup when the store is empty", async () => {
    fs.writeFileSync(
      path.join(tmp, "users.json"),
      JSON.stringify({ users: { pat: { username: "pat" } } }, null, 2)
    );
    fs.writeFileSync(
      path.join(tmp, "users", "pat.json"),
      JSON.stringify({ profile: { name: "Pat" } }, null, 2)
    );
    fs.writeFileSync(
      path.join(tmp, "suite", "users", "pat.json"),
      JSON.stringify({ profile: { name: "Pat Suite", occupation: "Nurse" } }, null, 2)
    );

    const made = await backup.createBackup({ reason: "before-wipe", actor: "test" });
    expect(made.id).toBeTruthy();
    expect(backup.INCLUDE_ENTRIES).toContain("suite");
    expect(backup.INCLUDE_ENTRIES).toContain("sessions.json");

    fs.writeFileSync(path.join(tmp, "users.json"), JSON.stringify({ users: {} }, null, 2));
    fs.rmSync(path.join(tmp, "users", "pat.json"), { force: true });
    fs.rmSync(path.join(tmp, "suite", "users", "pat.json"), { force: true });

    const restored = await backup.restoreLatestIfStoreEmpty();
    expect(restored.restored).toBe(true);
    expect(restored.accounts).toBeGreaterThan(0);

    const users = JSON.parse(fs.readFileSync(path.join(tmp, "users.json"), "utf8"));
    expect(users.users.pat.username).toBe("pat");
    const suiteRow = JSON.parse(fs.readFileSync(path.join(tmp, "suite", "users", "pat.json"), "utf8"));
    expect(suiteRow.profile.name).toBe("Pat Suite");
    expect(suiteRow.profile.occupation).toBe("Nurse");
  });

  it("leaves a healthy store alone", async () => {
    fs.writeFileSync(
      path.join(tmp, "users.json"),
      JSON.stringify({ users: { pat: { username: "pat" } } }, null, 2)
    );
    const result = await backup.restoreLatestIfStoreEmpty();
    expect(result.restored).toBe(false);
    expect(result.reason).toBe("store-present");
  });
});
