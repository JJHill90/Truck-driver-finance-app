const auth = require("./lib/auth");
const { scorePassword } = require("./lib/password-strength");

// Unique usernames per run so tests don't collide with existing data/users.json.
const uniq = () => `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
const strongPass = "RoadSafe!99x";
const emailFor = (u) => `${u}@example.com`;

describe("password strength", () => {
  it("flags common and short passwords as weak", () => {
    expect(scorePassword("password123").ok).toBe(false);
    expect(scorePassword("short").ok).toBe(false);
    expect(scorePassword(strongPass).ok).toBe(true);
    expect(scorePassword(strongPass).label).toBe("strong");
  });
});

describe("auth.registerUser / verifyUser", () => {
  it("registers a user with email and verifies the correct password", () => {
    const username = uniq();
    const created = auth.registerUser(username, strongPass, { defaultWorkUsePercent: 90 }, emailFor(username));
    expect(created.username).toBe(username);
    expect(created.email).toBe(emailFor(username));
    expect(created.hasEmail).toBe(true);
    expect(created.presets.defaultWorkUsePercent).toBe(90);

    const ok = auth.verifyUser(username, strongPass);
    expect(ok).not.toBeNull();
    expect(ok.username).toBe(username);

    expect(auth.verifyUser(username, "wrong-password")).toBeNull();
  });

  it("rejects duplicate usernames (case-insensitive)", () => {
    const username = uniq();
    auth.registerUser(username, strongPass, {}, emailFor(username));
    expect(() =>
      auth.registerUser(username.toUpperCase(), strongPass, {}, `other_${emailFor(username)}`)
    ).toThrow(/taken/i);
  });

  it("requires email and a strong password", () => {
    expect(() => auth.registerUser("ab", strongPass, {}, "a@b.co")).toThrow(/3.?32/);
    expect(() => auth.registerUser(uniq(), "short", {}, "a@b.co")).toThrow(/6 characters/);
    expect(() => auth.registerUser(uniq(), "password123", {}, "a@b.co")).toThrow(/stronger/i);
    expect(() => auth.registerUser(uniq(), strongPass, {}, "")).toThrow(/email/i);
  });
});

describe("auth.updatePresets / updateEmail", () => {
  it("merges presets onto the account", () => {
    const username = uniq();
    auth.registerUser(username, strongPass, { defaultWorkUsePercent: 100 }, emailFor(username));
    const updated = auth.updatePresets(username, { defaultCategory: "fuel" });
    expect(updated.presets.defaultWorkUsePercent).toBe(100);
    expect(updated.presets.defaultCategory).toBe("fuel");
  });

  it("updates email on the profile", () => {
    const username = uniq();
    auth.registerUser(username, strongPass, {}, emailFor(username));
    const next = `${username}.new@example.com`;
    const updated = auth.updateEmail(username, next);
    expect(updated.email).toBe(next);
  });
});

describe("auth sessions", () => {
  it("creates and resolves a session, then destroys it", () => {
    const username = uniq();
    auth.registerUser(username, strongPass, {}, emailFor(username));
    const token = auth.createSession(username);
    expect(auth.getSessionUser(token)).toBe(username);
    auth.destroySession(token);
    expect(auth.getSessionUser(token)).toBeNull();
  });
});

describe("auth.recordsFileFor", () => {
  it("produces a sanitised per-user file path", () => {
    const p = auth.recordsFileFor("Dave.Hill");
    expect(p).toMatch(/users[\\/]dave\.hill\.json$/);
  });
});

describe("failed logins and recovery", () => {
  it("flags needsRecovery after 10 failed attempts", () => {
    const username = uniq();
    auth.registerUser(username, strongPass, {}, emailFor(username));
    let last = null;
    for (let i = 0; i < auth.MAX_FAILED_LOGINS; i += 1) {
      last = auth.attemptLogin(username, "WrongPass!1");
    }
    expect(last.needsRecovery).toBe(true);
    expect(last.failedLoginCount).toBe(auth.MAX_FAILED_LOGINS);
    expect(last.locked).toBe(true);
  });

  it("hard-locks so the correct password is refused until cleared", () => {
    const username = uniq();
    auth.registerUser(username, strongPass, {}, emailFor(username));
    for (let i = 0; i < auth.MAX_FAILED_LOGINS; i += 1) {
      auth.attemptLogin(username, "WrongPass!1");
    }
    const locked = auth.attemptLogin(username, strongPass);
    expect(locked.user).toBeNull();
    expect(locked.locked).toBe(true);
    auth.clearFailedLogins(username);
    const ok = auth.attemptLogin(username, strongPass);
    expect(ok.user).not.toBeNull();
    expect(ok.user.username).toBe(username);
  });

  it("issues a recovery token and resets the password", () => {
    const username = uniq();
    const email = emailFor(username);
    auth.registerUser(username, strongPass, {}, email);
    const recovery = auth.createRecoveryTokenForEmail(email);
    expect(recovery.found).toBe(true);
    expect(recovery.username).toBe(username);
    const peek = auth.peekRecovery(recovery.token);
    expect(peek.username).toBe(username);
    const nextPass = "NewRoad!88y";
    const user = auth.resetPasswordWithToken(recovery.token, nextPass);
    expect(user.username).toBe(username);
    expect(auth.verifyUser(username, nextPass)).not.toBeNull();
    expect(auth.verifyUser(username, strongPass)).toBeNull();
  });
});

describe("account alerts", () => {
  it("warns when email is missing and when password is aged", () => {
    const username = uniq();
    // createUser without email
    auth.createUser(username, strongPass);
    const noEmail = auth.getUser(username);
    const alerts = auth.accountAlerts(noEmail);
    expect(alerts.some((a) => a.code === "missing_email")).toBe(true);

    const agedName = uniq();
    auth.registerUser(agedName, strongPass, {}, emailFor(agedName));
    const data = auth.loadUsers();
    const key = auth.usernameKey(agedName);
    const old = new Date(Date.now() - (auth.PASSWORD_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000);
    data.users[key].passwordChangedAt = old.toISOString();
    // persist via save through a no-op email update path: write users file by
    // reloading after setPassword would reset age — mutate on disk instead.
    const fs = require("fs");
    const path = require("path");
    const usersFile = path.join(__dirname, "data", "users.json");
    fs.writeFileSync(usersFile, JSON.stringify(data, null, 2), "utf8");
    const aged = auth.getUser(agedName);
    const agedAlerts = auth.accountAlerts(aged);
    expect(aged.passwordChangeDue).toBe(true);
    expect(agedAlerts.some((a) => a.code === "password_age")).toBe(true);
  });
});

describe("auth primary mod / admin", () => {
  it("bootstraps Haulage_Admin with default credentials and sole admin flag", () => {
    const prevUser = process.env.HAULAGE_ADMIN_USERNAME;
    const prevPass = process.env.HAULAGE_ADMIN_PASSWORD;
    process.env.HAULAGE_ADMIN_USERNAME = "Haulage_Admin";
    process.env.HAULAGE_ADMIN_PASSWORD = "Haulage_Admin";
    try {
      const boot = auth.ensureAdminBootstrap();
      expect(boot.username).toBe("Haulage_Admin");
      expect(boot.isAdmin).toBe(true);
      expect(auth.verifyUser("Haulage_Admin", "Haulage_Admin")).not.toBeNull();
      expect(auth.verifyUser("Haulage_Admin", "wrong-password")).toBeNull();
      expect(auth.isAdminUser("Haulage_Admin")).toBe(true);
    } finally {
      if (prevUser == null) delete process.env.HAULAGE_ADMIN_USERNAME;
      else process.env.HAULAGE_ADMIN_USERNAME = prevUser;
      if (prevPass == null) delete process.env.HAULAGE_ADMIN_PASSWORD;
      else process.env.HAULAGE_ADMIN_PASSWORD = prevPass;
    }
  });

  it("reports isAdminUser consistently with getUser", () => {
    const username = uniq();
    auth.registerUser(username, strongPass, {}, emailFor(username));
    const user = auth.getUser(username);
    expect(auth.isAdminUser(username)).toBe(Boolean(user.isAdmin));
  });

  it("ensurePrimaryAdmin keeps at least one admin when accounts exist", () => {
    auth.ensureAdminBootstrap();
    const users = auth.listUsers();
    expect(users.some((u) => u.isAdmin)).toBe(true);
  });

  it("createUser makes a non-admin driver profile", () => {
    const username = uniq();
    const created = auth.createUser(username, strongPass);
    expect(created.username).toBe(username);
    expect(created.isAdmin).toBe(false);
    expect(auth.verifyUser(username, strongPass)).not.toBeNull();
  });

  it("createUser refuses the reserved primary-mod username", () => {
    expect(() => auth.createUser("Haulage_Admin", strongPass)).toThrow(/reserved/i);
  });

  it("deleteUser removes a driver and refuses to delete the primary mod", () => {
    const username = uniq();
    auth.createUser(username, strongPass);
    const token = auth.createSession(username);
    expect(auth.getSessionUser(token)).toBe(username);

    const result = auth.deleteUser(username);
    expect(result.username).toBe(username);
    expect(auth.getUser(username)).toBeNull();
    expect(auth.getSessionUser(token)).toBeNull();

    auth.ensureAdminBootstrap();
    expect(() => auth.deleteUser("Haulage_Admin")).toThrow(/primary mod/i);
  });
});
