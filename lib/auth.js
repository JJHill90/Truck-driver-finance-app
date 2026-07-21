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
  return { username: user.username, presets: user.presets || {}, createdAt: user.createdAt };
}

function registerUser(username, password, presets = {}) {
  validateCredentials(username, password);
  const data = loadUsers();
  const key = usernameKey(username);
  if (data.users[key]) {
    throw new Error("That username is already taken. Try logging in instead.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    username: normaliseUsername(username),
    salt,
    hash: hashPassword(password, salt),
    presets: presets && typeof presets === "object" ? presets : {},
    createdAt: new Date().toISOString(),
  };
  data.users[key] = user;
  saveUsers(data);
  return publicUser(user);
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
  verifyUser,
  getUser,
  updatePresets,
  createSession,
  getSessionUser,
  destroySession,
  recordsFileFor,
  usernameKey,
  loadUsers,
};
