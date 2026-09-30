const fs = require("fs");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const suite = require("./lib/suite");
const accountDelete = require("./lib/account-delete");

const strongPass = "RoadSafe!99x";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "haulage-acct-del-"));
}

describe("account delete", () => {
  let tmp;

  beforeEach(() => {
    tmp = tmpDir();
    auth.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    fs.mkdirSync(path.join(tmp, "users"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "suite", "users"), { recursive: true });
    auth.ensureAdminBootstrap();
  });

  afterEach(() => {
    auth.setDataDirForTests(null);
    suite.setDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("requires DELETE plus the current password", async () => {
    const username = `del_${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    await expect(
      accountDelete.deleteOwnAccount({ username, password: strongPass, confirm: "please" })
    ).rejects.toThrow(/Type DELETE/i);
    await expect(
      accountDelete.deleteOwnAccount({ username, password: "wrong-pass", confirm: "DELETE" })
    ).rejects.toThrow(/password/i);
    expect(auth.getUser(username)).toBeTruthy();
  });

  it("wipes the login, haulage file, suite file and sessions", async () => {
    const username = `gone_${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    const token = auth.createSession(username);
    const haulageFile = auth.recordsFileFor(username);
    const suiteFile = suite.recordsFileFor(username);
    fs.writeFileSync(haulageFile, JSON.stringify({ expenses: [], receipts: [] }));
    fs.writeFileSync(suiteFile, JSON.stringify({ income: [], receipts: [] }));

    const result = await accountDelete.deleteOwnAccount({
      username,
      password: strongPass,
      confirm: "delete",
    });
    expect(result.ok).toBe(true);
    expect(auth.getUser(username)).toBeNull();
    expect(auth.getSessionUser(token)).toBeNull();
    expect(fs.existsSync(haulageFile)).toBe(false);
    expect(fs.existsSync(suiteFile)).toBe(false);
  });

  it("refuses to delete the primary mod", async () => {
    auth.ensureAdminBootstrap();
    const users = auth.loadUsers();
    const admin = Object.values(users.users || {}).find((u) => u && u.isAdmin);
    expect(admin).toBeTruthy();
    await expect(
      accountDelete.deleteOwnAccount({
        username: admin.username,
        password: strongPass,
        confirm: "DELETE",
      })
    ).rejects.toThrow(/primary mod/i);
    expect(auth.getUser(admin.username)).toBeTruthy();
  });
});
