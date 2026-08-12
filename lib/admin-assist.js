/**
 * Haulage_Admin assist helpers — login recovery and account overrides.
 * Wraps auth primitives so server routes stay thin and testable.
 */
const auth = require("./auth");

function requireTargetUser(username) {
  const user = auth.getUser(username);
  if (!user) throw new Error("User not found.");
  return user;
}

function adminSetPassword(username, password) {
  requireTargetUser(username);
  return auth.setPassword(username, password);
}

function adminSetEmail(username, email) {
  requireTargetUser(username);
  return auth.updateEmail(username, email);
}

function adminClearFailedLogins(username) {
  return auth.clearFailedLogins(username);
}

/**
 * Create a recovery link payload for a username (email optional on account).
 * Prefer email-based token when the account has an email; otherwise still
 * allow admin password reset instead.
 */
function adminCreateRecovery(username) {
  const user = requireTargetUser(username);
  if (!user.email) {
    throw new Error(
      "This account has no email on file. Set an email first, or reset their password directly."
    );
  }
  const recovery = auth.createRecoveryTokenForEmail(user.email);
  if (!recovery.found) {
    throw new Error("Could not create a recovery token for this account.");
  }
  return {
    username: recovery.username,
    email: recovery.email,
    token: recovery.token,
    expiresAt: recovery.expiresAt,
  };
}

function adminAccountStatus(username) {
  const user = requireTargetUser(username);
  return {
    username: user.username,
    email: user.email || null,
    hasEmail: Boolean(user.email),
    failedLoginCount: Number(user.failedLoginCount) || 0,
    needsRecovery: Boolean(user.needsRecovery),
    locked: Boolean(user.locked),
    lockedUntil: user.lockedUntil || null,
    isAdmin: Boolean(user.isAdmin),
    passwordAgeDays: user.passwordAgeDays,
    passwordChangeDue: Boolean(user.passwordChangeDue),
  };
}

module.exports = {
  adminSetPassword,
  adminSetEmail,
  adminClearFailedLogins,
  adminCreateRecovery,
  adminAccountStatus,
};
