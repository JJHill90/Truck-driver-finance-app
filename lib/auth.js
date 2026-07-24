// First-party multi-user auth for Haulage.
// Accounts persist to data/users.json (the app "cloud"); passwords are stored as
// salted PBKDF2 hashes. Sessions are held in memory (tokens) — accounts and data
// survive restarts; sessions do not (users simply log in again).
//
// NOTE: this is app-appropriate auth for a self-hosted finance tool, not a
// hardened public identity provider (no email verification, rate limiting, etc.).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USER_RECORDS_DIR = path.join(DATA_DIR, "users");

const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

const sessions = new Map(); // token -> username (canonical)

function ensureDirs() {
  fs.mkdirSync(USER_RECORDS_DIR, { recursive: true });
}

function loadUsers() {
  ensureDirs();
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
      return data && typeof data === "object" && data.users ? data : { users: {} };
    }
  } catch {
    /* fall through to empty */
  }
  return { users: {} };
}

function saveUsers(data) {
  ensureDirs();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function normaliseUsername(username) {
  return String(username || "").trim();
}

function usernameKey(username) {
  return normaliseUsername(username).toLowerCase();
}

/** Safe on-disk filename for a user's records store. */
function recordsFileFor(username) {
  const safe = usernameKey(username).replace(/[^a-z0-9_.-]/g, "_");
  return path.join(USER_RECORDS_DIR, `${safe}.json`);
}

function validateCredentials(username, password) {
  const u = normaliseUsername(username);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) {
    throw new Error("Username must be 3–32 characters (letters, numbers, . _ -).");
  }
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString("hex");
}

function publicUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    presets: user.presets || {},
    createdAt: user.createdAt,
    isAdmin: Boolean(user.isAdmin),
  };
}

/** Env override for the primary mod username (case-insensitive). */
function envAdminUsername() {
  return normaliseUsername(process.env.HAULAGE_ADMIN_USERNAME || "Haulage_Admin");
}

function envAdminPassword() {
  if (process.env.HAULAGE_ADMIN_PASSWORD) return String(process.env.HAULAGE_ADMIN_PASSWORD);
  // Default credentials for the designated primary-mod account (local + Render bootstrap).
  if (usernameKey(envAdminUsername()) === usernameKey("Haulage_Admin")) return "Haulage_Admin";
  return "";
}

/**
 * Ensure there is a primary mod:
 * - If HAULAGE_ADMIN_USERNAME is set and that account exists, that user is the
 *   sole admin.
 * - Otherwise, if no admin exists yet, the earliest-created account becomes admin.
 */
function ensurePrimaryAdmin() {
  const data = loadUsers();
  const users = Object.values(data.users);
  if (!users.length) return;

  const envAdmin = envAdminUsername();
  let changed = false;

  if (envAdmin && data.users[usernameKey(envAdmin)]) {
    for (const u of users) {
      const should = usernameKey(u.username) === usernameKey(envAdmin);
      if (Boolean(u.isAdmin) !== should) {
        u.isAdmin = should;
        changed = true;
      }
    }
  } else if (!users.some((u) => u.isAdmin)) {
    users
      .slice()
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0].isAdmin = true;
    changed = true;
  }

  if (changed) saveUsers(data);
}

/** Set or replace a user's password (keeps username casing / presets). */
function setPassword(username, password) {
  validateCredentials(username, password);
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) throw new Error("Unknown user.");
  const salt = crypto.randomBytes(16).toString("hex");
  user.salt = salt;
  user.hash = hashPassword(password, salt);
  saveUsers(data);
  return publicUser(user);
}

/**
 * Create/update the primary-mod account from env (or Haulage_Admin defaults)
 * and ensure it is the sole admin. Safe to call on every boot — idempotent.
 */
function ensureAdminBootstrap() {
  const username = envAdminUsername();
  const password = envAdminPassword();
  if (!username || !password) {
    ensurePrimaryAdmin();
    return username ? getUser(username) : null;
  }

  const data = loadUsers();
  const key = usernameKey(username);

  if (!data.users[key]) {
    const salt = crypto.randomBytes(16).toString("hex");
    data.users[key] = {
      username: normaliseUsername(username),
      salt,
      hash: hashPassword(password, salt),
      presets: {},
      createdAt: new Date().toISOString(),
      isAdmin: true,
    };
    saveUsers(data);
  } else if (!verifyUser(username, password)) {
    const salt = crypto.randomBytes(16).toString("hex");
    data.users[key].salt = salt;
    data.users[key].hash = hashPassword(password, salt);
    saveUsers(data);
  }

  // Sole admin = designated primary mod.
  const fresh = loadUsers();
  let changed = false;
  for (const other of Object.values(fresh.users)) {
    const should = usernameKey(other.username) === key;
    if (Boolean(other.isAdmin) !== should) {
      other.isAdmin = should;
      changed = true;
    }
  }
  if (changed) saveUsers(fresh);
  return publicUser(fresh.users[key]);
}

function isAdminUser(username) {
  if (!username) return false;
  ensurePrimaryAdmin();
  const data = loadUsers();
  const user = data.users[usernameKey(username)];
  return Boolean(user && user.isAdmin);
}

/** Public list of accounts (no password material). */
function listUsers() {
  ensurePrimaryAdmin();
  const data = loadUsers();
  return Object.values(data.users)
    .map((u) => publicUser(u))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function registerUser(username, password, presets = {}) {
  validateCredentials(username, password);
  const data = loadUsers();
  const key = usernameKey(username);
  if (data.users[key]) {
    throw new Error("That username is already taken. Try logging in instead.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const existingCount = Object.keys(data.users).length;
  const envAdmin = envAdminUsername();
  const makeAdmin =
    existingCount === 0 || (envAdmin && usernameKey(username) === usernameKey(envAdmin));
  const user = {
    username: normaliseUsername(username),
    salt,
    hash: hashPassword(password, salt),
    presets: presets && typeof presets === "object" ? presets : {},
    createdAt: new Date().toISOString(),
    isAdmin: makeAdmin,
  };
  data.users[key] = user;
  // If env designates this new user as admin, demote others.
  if (makeAdmin && envAdmin && usernameKey(username) === usernameKey(envAdmin)) {
    for (const other of Object.values(data.users)) {
      if (usernameKey(other.username) !== key) other.isAdmin = false;
    }
  }
  saveUsers(data);
  return publicUser(user);
}

/**
 * Primary-mod creates a driver profile (never grants admin).
 * Does not start a session for the new user.
 */
function createUser(username, password, presets = {}) {
  validateCredentials(username, password);
  if (usernameKey(username) === usernameKey(envAdminUsername())) {
    throw new Error("That username is reserved for the primary mod.");
  }
  const data = loadUsers();
  const key = usernameKey(username);
  if (data.users[key]) {
    throw new Error("That username is already taken.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    username: normaliseUsername(username),
    salt,
    hash: hashPassword(password, salt),
    presets: presets && typeof presets === "object" ? presets : {},
    createdAt: new Date().toISOString(),
    isAdmin: false,
  };
  data.users[key] = user;
  saveUsers(data);
  return publicUser(user);
}

function destroySessionsForUser(username) {
  const key = usernameKey(username);
  for (const [token, sessionUser] of sessions.entries()) {
    if (usernameKey(sessionUser) === key) sessions.delete(token);
  }
}

/**
 * Remove a user account. Refuses to delete the primary mod.
 * Returns { username, recordsFile } so the caller can wipe stored data/files.
 */
function deleteUser(username) {
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) throw new Error("User not found.");
  if (user.isAdmin || usernameKey(user.username) === usernameKey(envAdminUsername())) {
    throw new Error("Cannot delete the primary mod account.");
  }
  const recordsFile = recordsFileFor(user.username);
  delete data.users[key];
  saveUsers(data);
  destroySessionsForUser(user.username);
  return { username: user.username, recordsFile };
}

function verifyUser(username, password) {
  const data = loadUsers();
  const user = data.users[usernameKey(username)];
  if (!user) return null;
  const candidate = hashPassword(password, user.salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(user.hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return publicUser(user);
}

function getUser(username) {
  ensurePrimaryAdmin();
  const data = loadUsers();
  return publicUser(data.users[usernameKey(username)]);
}

function updatePresets(username, presets) {
  const data = loadUsers();
  const user = data.users[usernameKey(username)];
  if (!user) throw new Error("Unknown user.");
  user.presets = { ...(user.presets || {}), ...(presets || {}) };
  saveUsers(data);
  return publicUser(user);
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, normaliseUsername(username));
  return token;
}

function getSessionUser(token) {
  return (token && sessions.get(token)) || null;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

module.exports = {
  registerUser,
  createUser,
  deleteUser,
  verifyUser,
  getUser,
  updatePresets,
  createSession,
  getSessionUser,
  destroySession,
  destroySessionsForUser,
  recordsFileFor,
  usernameKey,
  loadUsers,
  listUsers,
  isAdminUser,
  ensurePrimaryAdmin,
  setPassword,
  ensureAdminBootstrap,
  envAdminUsername,
};
