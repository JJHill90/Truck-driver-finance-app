const fs = require("fs");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const suite = require("./lib/suite");
const reviewerDemo = require("./lib/reviewer-demo");

const strongPass = "Review!Suite2026x";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "suite-reviewer-"));
}

describe("store reviewer demo account", () => {
  let tmp;
  const prev = {};

  beforeEach(() => {
    tmp = tmpDir();
    auth.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    fs.mkdirSync(path.join(tmp, "users"), { recursive: true });
    auth.ensureAdminBootstrap();
    for (const key of [
      "SUITE_REVIEWER_USERNAME",
      "SUITE_REVIEWER_PASSWORD",
      "SUITE_REVIEWER_EMAIL",
    ]) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    auth.setDataDirForTests(null);
    suite.setDataDirForTests(null);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does nothing when reviewer env vars are unset", () => {
    const result = reviewerDemo.ensureReviewerDemo();
    expect(result).toEqual({ ready: false, reason: "unset" });
    expect(auth.listUsers().filter((u) => !u.isAdmin)).toHaveLength(0);
  });

  it("refuses to reuse the primary mod username", () => {
    const admin = auth.listUsers().find((u) => u.isAdmin);
    expect(admin).toBeTruthy();
    process.env.SUITE_REVIEWER_USERNAME = admin.username;
    process.env.SUITE_REVIEWER_PASSWORD = strongPass;
    const result = reviewerDemo.ensureReviewerDemo();
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("reserved-admin");
  });

  it("creates a non-admin Pro+ reviewer with a sample Suite ledger", () => {
    process.env.SUITE_REVIEWER_USERNAME = "suite.reviewer";
    process.env.SUITE_REVIEWER_PASSWORD = strongPass;
    process.env.SUITE_REVIEWER_EMAIL = "reviewer@example.com";

    const first = reviewerDemo.ensureReviewerDemo();
    expect(first.ready).toBe(true);
    expect(first.created).toBe(true);
    expect(first.seeded).toBe(true);

    const user = auth.getUser("suite.reviewer");
    expect(user.isAdmin).toBe(false);
    expect(user.isProPlus).toBe(true);
    expect(user.email).toBe("reviewer@example.com");

    const session = auth.attemptLogin("suite.reviewer", strongPass);
    expect(session.user).toBeTruthy();

    const file = suite.recordsFileFor("suite.reviewer");
    const records = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(records.profile.name).toBe("Alex Chen");
    expect(records.profile.entityType).toBe("employee");
    expect(records.profile.driverType).not.toMatch(/haul|truck/i);
    expect(records.income.length).toBeGreaterThan(0);
    expect(records.expenses.length).toBeGreaterThan(0);

    const again = reviewerDemo.ensureReviewerDemo();
    expect(again.ready).toBe(true);
    expect(again.created).toBe(false);
    expect(again.seeded).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).profile.name).toBe("Alex Chen");
  });

  it("returns a clear error when the password is too weak", () => {
    process.env.SUITE_REVIEWER_USERNAME = "suite.reviewer";
    process.env.SUITE_REVIEWER_PASSWORD = "password";
    const result = reviewerDemo.ensureReviewerDemo();
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.error).toMatch(/password/i);
  });
});
