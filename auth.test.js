const auth = require("./lib/auth");

// Unique usernames per run so tests don't collide with existing data/users.json.
const uniq = () => `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

describe("auth.registerUser / verifyUser", () => {
  it("registers a user and verifies the correct password", () => {
    const username = uniq();
    const created = auth.registerUser(username, "secret123", { defaultWorkUsePercent: 90 });
    expect(created.username).toBe(username);
    expect(created.presets.defaultWorkUsePercent).toBe(90);

    const ok = auth.verifyUser(username, "secret123");
    expect(ok).not.toBeNull();
    expect(ok.username).toBe(username);

    expect(auth.verifyUser(username, "wrong-password")).toBeNull();
  });

  it("rejects duplicate usernames (case-insensitive)", () => {
    const username = uniq();
    auth.registerUser(username, "secret123");
    expect(() => auth.registerUser(username.toUpperCase(), "secret123")).toThrow(/taken/i);
  });

  it("validates username and password", () => {
    expect(() => auth.registerUser("ab", "secret123")).toThrow(/3.?32/);
    expect(() => auth.registerUser(uniq(), "short")).toThrow(/6 characters/);
  });
});

describe("auth.updatePresets", () => {
  it("merges presets onto the account", () => {
    const username = uniq();
    auth.registerUser(username, "secret123", { defaultWorkUsePercent: 100 });
    const updated = auth.updatePresets(username, { defaultCategory: "fuel" });
    expect(updated.presets.defaultWorkUsePercent).toBe(100);
    expect(updated.presets.defaultCategory).toBe("fuel");
  });
});

describe("auth sessions", () => {
  it("creates and resolves a session, then destroys it", () => {
    const username = uniq();
    auth.registerUser(username, "secret123");
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
    auth.registerUser(username, "secret123");
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
    const created = auth.createUser(username, "temp-pass-1");
    expect(created.username).toBe(username);
    expect(created.isAdmin).toBe(false);
    expect(auth.verifyUser(username, "temp-pass-1")).not.toBeNull();
  });

  it("createUser refuses the reserved primary-mod username", () => {
    expect(() => auth.createUser("Haulage_Admin", "temp-pass-1")).toThrow(/reserved/i);
  });

  it("deleteUser removes a driver and refuses to delete the primary mod", () => {
    const username = uniq();
    auth.createUser(username, "temp-pass-1");
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
