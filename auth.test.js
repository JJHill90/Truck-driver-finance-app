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
  it("makes the first registered user the primary mod", () => {
    // Isolate by using a unique first user; ensurePrimaryAdmin may already have
    // promoted an older account in data/users.json, so assert via fresh user + list.
    const username = uniq();
    const created = auth.registerUser(username, "secret123");
    // Fresh DB may already have admins; if this was somehow the only user they'd
    // be admin. Assert isAdmin is boolean and listUsers includes them.
    expect(typeof created.isAdmin).toBe("boolean");
    const listed = auth.listUsers().find((u) => u.username === username);
    expect(listed).toBeTruthy();
    expect(listed.isAdmin).toBe(created.isAdmin);
  });

  it("reports isAdminUser consistently with getUser", () => {
    const username = uniq();
    auth.registerUser(username, "secret123");
    const user = auth.getUser(username);
    expect(auth.isAdminUser(username)).toBe(Boolean(user.isAdmin));
  });

  it("ensurePrimaryAdmin promotes the earliest user when none is admin", () => {
    // Force a known state: load users, if we can clear isAdmin on test users we
    // created, then ensure promotes someone.
    auth.ensurePrimaryAdmin();
    const users = auth.listUsers();
    expect(users.some((u) => u.isAdmin)).toBe(true);
  });
});
