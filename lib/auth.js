// First-party multi-user auth for Haulage.
// Accounts persist to data/users.json (the app "cloud"); passwords are stored as
// salted PBKDF2 hashes. Sessions are held in memory (tokens) — accounts and data
// survive restarts; sessions do not (users simply log in again).
//
// Email + recovery: optional SMTP via lib/mail.js. Failed logins (10) unlock
// recovery; passwords should be changed every 90 days.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assertStrongEnoughPassword, scorePassword } = require("./password-strength");
const { writeJsonAtomic } = require("./atomic-write");
const {
  ensureBillingFields,
  isPro,
  displayPlanTier,
  assignSignupTrial,
  trialOfferStatus,
  trialExpired,
  trialEndingSoon,
  applyAdminPlanGrant,
  normalisedPlanGrant,
  resolveEntitlements,
  TRIAL_MONTHS,
  TRIAL_PRODUCT_LABEL,
  PRO_PRICE_LABEL,
  FREE_UPLOADS_PER_MONTH,
  FREE_ONSCREEN_REPORTS,
} = require("./entitlements");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USER_RECORDS_DIR = path.join(DATA_DIR, "users");

const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

const MAX_FAILED_LOGINS = 10;
const RECOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
const PASSWORD_MAX_AGE_DAYS = 90;
const PASSWORD_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // weekly
/** Hard lockout duration after MAX_FAILED_LOGINS (admin clear also unlocks). */
function lockoutMs() {
  const n = Number(process.env.AUTH_LOCKOUT_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30 * 60 * 1000;
}

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
  writeJsonAtomic(USERS_FILE, data);
}

function normaliseUsername(username) {
  return String(username || "").trim();
}

function usernameKey(username) {
  return normaliseUsername(username).toLowerCase();
}

function normaliseEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function validateEmail(email, { required = false } = {}) {
  const e = normaliseEmail(email);
  if (!e) {
    if (required) throw new Error("Email address is required.");
    return "";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) {
    throw new Error("Enter a valid email address.");
  }
  return e;
}

/** Safe on-disk filename for a user's records store. */
function recordsFileFor(username) {
  const safe = usernameKey(username).replace(/[^a-z0-9_.-]/g, "_");
  return path.join(USER_RECORDS_DIR, `${safe}.json`);
}

function validateUsername(username) {
  const u = normaliseUsername(username);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) {
    throw new Error("Username must be 3–32 characters (letters, numbers, . _ -).");
  }
  return u;
}

function validateCredentials(username, password, { requireStrong = false } = {}) {
  validateUsername(username);
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if (requireStrong) {
    assertStrongEnoughPassword(password, username);
  }
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString("hex");
}

function passwordAgeDays(user) {
  const raw = user.passwordChangedAt || user.createdAt;
  if (!raw) return 0;
  const then = new Date(raw).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

function lockoutActive(user) {
  if (!user) return false;
  const count = Number(user.failedLoginCount) || 0;
  if (count < MAX_FAILED_LOGINS) return false;
  if (!user.lockedUntil) return true;
  const until = new Date(user.lockedUntil).getTime();
  if (!Number.isFinite(until)) return true;
  return Date.now() < until;
}

function publicUser(user) {
  if (!user) return null;
  ensureBillingFields(user);
  const age = passwordAgeDays(user);
  const failed = Number(user.failedLoginCount) || 0;
  const locked = lockoutActive(user);
  return {
    username: user.username,
    email: user.email || null,
    hasEmail: Boolean(user.email),
    presets: user.presets || {},
    createdAt: user.createdAt,
    isAdmin: Boolean(user.isAdmin),
    passwordChangedAt: user.passwordChangedAt || user.createdAt || null,
    passwordAgeDays: age,
    passwordChangeDue: age >= PASSWORD_MAX_AGE_DAYS,
    failedLoginCount: failed,
    needsRecovery: failed >= MAX_FAILED_LOGINS || locked,
    locked,
    lockedUntil: user.lockedUntil || null,
    plan: user.plan || "free",
    isPro: isPro(user),
    displayPlan: displayPlanTier(user),
    planGrant: normalisedPlanGrant(user),
    planGrantedAt: user.planGrantedAt || null,
    planGrantedBy: user.planGrantedBy || null,
    proTrialEndsAt: user.proTrialEndsAt || null,
    trialLabel: TRIAL_PRODUCT_LABEL,
    trialMonths: TRIAL_MONTHS,
    subscriptionStatus: user.subscriptionStatus || null,
    subscriptionInterval: user.subscriptionInterval || null,
    currentPeriodEnd: user.currentPeriodEnd || null,
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    hasStripeCustomer: Boolean(user.stripeCustomerId),
    hasStripeSubscription: Boolean(user.stripeSubscriptionId),
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

function findUserKeyByEmail(data, email) {
  const target = normaliseEmail(email);
  if (!target) return null;
  for (const [key, user] of Object.entries(data.users)) {
    if (normaliseEmail(user.email) === target) return key;
  }
  return null;
}

function emailTaken(data, email, exceptUsername = "") {
  const key = findUserKeyByEmail(data, email);
  if (!key) return false;
  if (exceptUsername && key === usernameKey(exceptUsername)) return false;
  return true;
}

/** Set or replace a user's password (keeps username casing / presets). */
function setPassword(username, password) {
  validateCredentials(username, password, { requireStrong: true });
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) throw new Error("Unknown user.");
  const salt = crypto.randomBytes(16).toString("hex");
  user.salt = salt;
  user.hash = hashPassword(password, salt);
  user.passwordChangedAt = new Date().toISOString();
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.recoveryTokenHash = null;
  user.recoveryExpiresAt = null;
  saveUsers(data);
  destroySessionsForUser(user.username);
  return publicUser(user);
}

/** Clear lockout / failed-login counter without changing the password. */
function clearFailedLogins(username) {
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) throw new Error("Unknown user.");
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.recoveryTokenHash = null;
  user.recoveryExpiresAt = null;
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
  const now = new Date().toISOString();

  if (!data.users[key]) {
    const salt = crypto.randomBytes(16).toString("hex");
    data.users[key] = {
      username: normaliseUsername(username),
      salt,
      hash: hashPassword(password, salt),
      email: "",
      presets: {},
      createdAt: now,
      passwordChangedAt: now,
      failedLoginCount: 0,
      isAdmin: true,
      plan: "free",
      proTrialEndsAt: null,
    };
    saveUsers(data);
  } else if (!verifyPasswordOnly(username, password)) {
    const salt = crypto.randomBytes(16).toString("hex");
    data.users[key].salt = salt;
    data.users[key].hash = hashPassword(password, salt);
    data.users[key].passwordChangedAt = now;
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

function registerUser(username, password, presets = {}, email = "") {
  validateCredentials(username, password, { requireStrong: true });
  const cleanEmail = validateEmail(email, { required: true });
  const data = loadUsers();
  const key = usernameKey(username);
  if (data.users[key]) {
    throw new Error("That username is already taken. Try logging in instead.");
  }
  if (emailTaken(data, cleanEmail)) {
    throw new Error("That email is already used by another profile.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const existingCount = Object.keys(data.users).length;
  const envAdmin = envAdminUsername();
  const makeAdmin =
    existingCount === 0 || (envAdmin && usernameKey(username) === usernameKey(envAdmin));
  const now = new Date().toISOString();
  const user = {
    username: normaliseUsername(username),
    salt,
    hash: hashPassword(password, salt),
    email: cleanEmail,
    presets: presets && typeof presets === "object" ? presets : {},
    createdAt: now,
    passwordChangedAt: now,
    failedLoginCount: 0,
    isAdmin: makeAdmin,
    plan: "free",
    proTrialEndsAt: null,
  };
  // Every new driver signup gets Pro+ trial; primary mod is always Pro without a trial.
  if (!makeAdmin) assignSignupTrial(user);
  data.users[key] = user;
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
function createUser(username, password, presets = {}, email = "") {
  validateCredentials(username, password, { requireStrong: true });
  if (usernameKey(username) === usernameKey(envAdminUsername())) {
    throw new Error("That username is reserved for the primary mod.");
  }
  const cleanEmail = email ? validateEmail(email, { required: true }) : "";
  const data = loadUsers();
  const key = usernameKey(username);
  if (data.users[key]) {
    throw new Error("That username is already taken.");
  }
  if (cleanEmail && emailTaken(data, cleanEmail)) {
    throw new Error("That email is already used by another profile.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const user = {
    username: normaliseUsername(username),
    salt,
    hash: hashPassword(password, salt),
    email: cleanEmail,
    presets: presets && typeof presets === "object" ? presets : {},
    createdAt: now,
    passwordChangedAt: now,
    failedLoginCount: 0,
    isAdmin: false,
    plan: "free",
    proTrialEndsAt: null,
  };
  assignSignupTrial(user);
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

function verifyPasswordOnly(username, password) {
  const data = loadUsers();
  const user = data.users[usernameKey(username)];
  if (!user) return false;
  const candidate = hashPassword(password, user.salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(user.hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return true;
}

/**
 * Verify credentials and track failed attempts.
 * After MAX_FAILED_LOGINS the account is hard-locked (correct password refused)
 * until cooldown (AUTH_LOCKOUT_MS) expires or an admin clears the lockout.
 * @returns {{ user: object|null, needsRecovery: boolean, failedLoginCount: number, locked?: boolean, lockedUntil?: string|null }}
 */
function attemptLogin(username, password) {
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) {
    return { user: null, needsRecovery: false, failedLoginCount: 0, locked: false };
  }

  // Expired cooldown → clear counters before verifying.
  if (
    (Number(user.failedLoginCount) || 0) >= MAX_FAILED_LOGINS &&
    user.lockedUntil &&
    Date.now() >= new Date(user.lockedUntil).getTime()
  ) {
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    saveUsers(data);
  }

  if (lockoutActive(user)) {
    return {
      user: null,
      needsRecovery: true,
      failedLoginCount: Number(user.failedLoginCount) || 0,
      locked: true,
      lockedUntil: user.lockedUntil || null,
    };
  }

  const candidate = hashPassword(password, user.salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(user.hash, "hex");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (ok) {
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    saveUsers(data);
    return {
      user: publicUser(user),
      needsRecovery: false,
      failedLoginCount: 0,
      locked: false,
    };
  }

  user.failedLoginCount = (Number(user.failedLoginCount) || 0) + 1;
  const count = user.failedLoginCount;
  if (count >= MAX_FAILED_LOGINS) {
    const ms = lockoutMs();
    user.lockedUntil = ms > 0 ? new Date(Date.now() + ms).toISOString() : null;
  }
  saveUsers(data);
  return {
    user: null,
    needsRecovery: count >= MAX_FAILED_LOGINS,
    failedLoginCount: count,
    locked: count >= MAX_FAILED_LOGINS,
    lockedUntil: user.lockedUntil || null,
  };
}

/** Legacy helper used by tests / bootstrap — does not bump fail counters. */
function verifyUser(username, password) {
  if (!verifyPasswordOnly(username, password)) return null;
  const data = loadUsers();
  return publicUser(data.users[usernameKey(username)]);
}

function getUserRecord(username) {
  ensurePrimaryAdmin();
  const data = loadUsers();
  const user = data.users[usernameKey(username)];
  if (!user) return null;
  if (ensureBillingFields(user)) saveUsers(data);
  return user;
}

function getUser(username) {
  return publicUser(getUserRecord(username));
}

function updateBilling(username, patch = {}) {
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) throw new Error("Unknown user.");
  Object.assign(user, patch || {});
  ensureBillingFields(user);
  saveUsers(data);
  return publicUser(user);
}

/**
 * Primary mod upgrades/downgrades a driver between Free and Pro+.
 * @param {string} username
 * @param {"pro_plus"|"free"} grant
 * @param {{ by?: string }} [meta]
 */
function setPlanGrant(username, grant, meta = {}) {
  ensurePrimaryAdmin();
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) throw new Error("User not found.");
  applyAdminPlanGrant(user, grant, {
    by: meta.by || null,
    at: new Date().toISOString(),
  });
  ensureBillingFields(user);
  saveUsers(data);
  const pub = publicUser(user);
  return {
    user: pub,
    entitlements: resolveEntitlements(user, null),
  };
}

function findUsernameByStripeCustomerId(customerId) {
  if (!customerId) return null;
  const data = loadUsers();
  for (const u of Object.values(data.users)) {
    if (u.stripeCustomerId === customerId) return u.username;
  }
  return null;
}

function updatePresets(username, presets) {
  const data = loadUsers();
  const user = data.users[usernameKey(username)];
  if (!user) throw new Error("Unknown user.");
  user.presets = { ...(user.presets || {}), ...(presets || {}) };
  saveUsers(data);
  return publicUser(user);
}

function updateEmail(username, email) {
  const cleanEmail = validateEmail(email, { required: true });
  const data = loadUsers();
  const key = usernameKey(username);
  const user = data.users[key];
  if (!user) throw new Error("Unknown user.");
  if (emailTaken(data, cleanEmail, username)) {
    throw new Error("That email is already used by another profile.");
  }
  user.email = cleanEmail;
  saveUsers(data);
  return publicUser(user);
}

function changePassword(username, currentPassword, newPassword) {
  if (!verifyPasswordOnly(username, currentPassword)) {
    throw new Error("Current password is incorrect.");
  }
  return setPassword(username, newPassword);
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

/**
 * Start recovery for an email. Always returns a generic result to avoid
 * account enumeration; includes raw token only when mail was not sent (dev).
 */
function createRecoveryTokenForEmail(email) {
  const cleanEmail = validateEmail(email, { required: true });
  const data = loadUsers();
  const key = findUserKeyByEmail(data, cleanEmail);
  if (!key) {
    return { found: false, username: null, token: null, expiresAt: null };
  }
  const user = data.users[key];
  const token = crypto.randomBytes(24).toString("hex");
  user.recoveryTokenHash = hashPassword(token, user.salt);
  user.recoveryExpiresAt = new Date(Date.now() + RECOVERY_TTL_MS).toISOString();
  saveUsers(data);
  return {
    found: true,
    username: user.username,
    email: user.email,
    token,
    expiresAt: user.recoveryExpiresAt,
  };
}

function peekRecovery(token) {
  const raw = String(token || "").trim();
  if (!raw) throw new Error("Recovery link is missing or invalid.");
  const data = loadUsers();
  const now = Date.now();
  for (const user of Object.values(data.users)) {
    if (!user.recoveryTokenHash || !user.recoveryExpiresAt) continue;
    if (new Date(user.recoveryExpiresAt).getTime() < now) continue;
    const candidate = hashPassword(raw, user.salt);
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(user.recoveryTokenHash, "hex");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { username: user.username, email: user.email || null };
    }
  }
  throw new Error("This recovery link is invalid or has expired. Request a new one.");
}

function resetPasswordWithToken(token, newPassword) {
  const raw = String(token || "").trim();
  if (!raw) throw new Error("Recovery link is missing or invalid.");
  const data = loadUsers();
  const now = Date.now();
  for (const user of Object.values(data.users)) {
    if (!user.recoveryTokenHash || !user.recoveryExpiresAt) continue;
    if (new Date(user.recoveryExpiresAt).getTime() < now) continue;
    const candidate = hashPassword(raw, user.salt);
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(user.recoveryTokenHash, "hex");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      assertStrongEnoughPassword(newPassword, user.username);
      const salt = crypto.randomBytes(16).toString("hex");
      user.salt = salt;
      user.hash = hashPassword(newPassword, salt);
      user.passwordChangedAt = new Date().toISOString();
      user.failedLoginCount = 0;
      user.lockedUntil = null;
      user.recoveryTokenHash = null;
      user.recoveryExpiresAt = null;
      saveUsers(data);
      destroySessionsForUser(user.username);
      return publicUser(user);
    }
  }
  throw new Error("This recovery link is invalid or has expired. Request a new one.");
}

/** In-app account alerts (missing email / password age). */
function accountAlerts(user) {
  const alerts = [];
  if (!user) return alerts;
  if (!user.hasEmail) {
    alerts.push({
      level: "warning",
      code: "missing_email",
      message:
        "No email is attached to your profile. Add one on the Profile tab so you can recover your username and password.",
    });
  }
  if (user.passwordChangeDue) {
    alerts.push({
      level: "warning",
      code: "password_age",
      message: `Your password is ${user.passwordAgeDays} days old. Please change it (recommended every ${PASSWORD_MAX_AGE_DAYS} days).`,
    });
  }
  // Billing: nudge after (or just before) the Pro+ trial — soft, not mid-flow.
  // `user` is typically a publicUser (has proTrialEndsAt / subscriptionStatus).
  if (!user.isAdmin) {
    if (trialExpired(user)) {
      alerts.push({
        level: "warning",
        code: "trial_ended",
        message: `Your ${TRIAL_MONTHS}-month ${TRIAL_PRODUCT_LABEL} trial has ended. You’re on Free (${FREE_UPLOADS_PER_MONTH} uploads/month + ${FREE_ONSCREEN_REPORTS} on-screen EOFY report) — update to Pro (${PRO_PRICE_LABEL}) on the Profile tab for unlimited scans, PDF export and forecast.`,
      });
    } else if (trialEndingSoon(user)) {
      alerts.push({
        level: "info",
        code: "trial_ending",
        message: `Your ${TRIAL_PRODUCT_LABEL} trial ends soon. Afterwards you keep Free (${FREE_UPLOADS_PER_MONTH} uploads/month + ${FREE_ONSCREEN_REPORTS} on-screen report), or start Pro (${PRO_PRICE_LABEL}) anytime from Profile → Plan — including from day one of signup.`,
      });
    }
  }
  return alerts;
}

/**
 * Whether we should email a 90-day reminder (cooldown to avoid spam).
 * Marks the user when due.
 */
function consumePasswordReminder(username) {
  const data = loadUsers();
  const user = data.users[usernameKey(username)];
  if (!user || !user.email) return null;
  const pub = publicUser(user);
  if (!pub.passwordChangeDue) return null;
  const last = user.lastPasswordReminderAt ? new Date(user.lastPasswordReminderAt).getTime() : 0;
  if (Date.now() - last < PASSWORD_REMINDER_COOLDOWN_MS) return null;
  user.lastPasswordReminderAt = new Date().toISOString();
  saveUsers(data);
  return pub;
}

function getTrialOfferStatus() {
  return trialOfferStatus();
}

/** @deprecated Prefer getTrialOfferStatus. */
function getFoundingStatus() {
  return getTrialOfferStatus();
}

module.exports = {
  registerUser,
  createUser,
  deleteUser,
  verifyUser,
  attemptLogin,
  getUser,
  updatePresets,
  updateEmail,
  changePassword,
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
  clearFailedLogins,
  ensureAdminBootstrap,
  envAdminUsername,
  createRecoveryTokenForEmail,
  peekRecovery,
  resetPasswordWithToken,
  accountAlerts,
  consumePasswordReminder,
  scorePassword,
  validateEmail,
  getUserRecord,
  updateBilling,
  setPlanGrant,
  findUsernameByStripeCustomerId,
  getTrialOfferStatus,
  getFoundingStatus,
  MAX_FAILED_LOGINS,
  PASSWORD_MAX_AGE_DAYS,
  lockoutMs,
  lockoutActive,
};
