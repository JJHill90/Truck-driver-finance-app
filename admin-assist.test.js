const fs = require("fs");
const path = require("path");
const auth = require("./lib/auth");
const adminAssist = require("./lib/admin-assist");

const USERS_FILE = path.join(__dirname, "data", "users.json");
const USERS_DIR = path.join(__dirname, "data", "users");

function resetAuthFiles() {
  fs.mkdirSync(USERS_DIR, { recursive: true });
  if (fs.existsSync(USERS_FILE)) fs.unlinkSync(USERS_FILE);
}

describe("admin-assist", () => {
  beforeEach(() => {
    resetAuthFiles();
    auth.ensureAdminBootstrap();
  });

  it("resets password and clears failed logins", () => {
    auth.createUser("driver.one", "TempPass1!", {}, "driver@example.com");
    // Simulate lockout
    for (let i = 0; i < auth.MAX_FAILED_LOGINS; i += 1) {
      auth.attemptLogin("driver.one", "wrong-password");
    }
    let user = auth.getUser("driver.one");
    expect(user.needsRecovery).toBe(true);

    user = adminAssist.adminClearFailedLogins("driver.one");
    expect(user.failedLoginCount).toBe(0);
    expect(user.needsRecovery).toBe(false);

    adminAssist.adminSetPassword("driver.one", "NewPass99!");
    const login = auth.attemptLogin("driver.one", "NewPass99!");
    expect(login.user).toBeTruthy();
  });

  it("updates email and builds a recovery token", () => {
    auth.createUser("driver.two", "TempPass1!", {});
    expect(() => adminAssist.adminCreateRecovery("driver.two")).toThrow(/no email/i);

    const updated = adminAssist.adminSetEmail("driver.two", "two@example.com");
    expect(updated.email).toBe("two@example.com");

    const recovery = adminAssist.adminCreateRecovery("driver.two");
    expect(recovery.username).toBe("driver.two");
    expect(recovery.token).toBeTruthy();
  });

  it("reports account status for assist UI", () => {
    auth.createUser("driver.three", "TempPass1!", {}, "three@example.com");
    const status = adminAssist.adminAccountStatus("driver.three");
    expect(status.username).toBe("driver.three");
    expect(status.hasEmail).toBe(true);
    expect(status.failedLoginCount).toBe(0);
  });
});
