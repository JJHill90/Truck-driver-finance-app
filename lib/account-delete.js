/**
 * Self-serve and admin account wipe.
 *
 * Drivers can delete their own profile (password + confirm DELETE).
 * The primary mod cannot be deleted. Stripe subscriptions are cancelled
 * immediately so a deleted user is not billed after the wipe.
 */
const fs = require("fs");
const auth = require("./auth");
const storage = require("./storage");
const suite = require("./suite");
const billingStripe = require("./billing-stripe");

const CONFIRM_WORD = "DELETE";

function normalizeConfirm(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function loadCachedOrDisk(username, cacheKey, filePath, recordsCache) {
  if (recordsCache && recordsCache.has(cacheKey)) {
    return recordsCache.get(cacheKey);
  }
  if (filePath && fs.existsSync(filePath)) {
    try {
      return storage.loadRecords(filePath);
    } catch {
      return null;
    }
  }
  return null;
}

function deleteReceiptsFromRecords(records) {
  if (!records) return 0;
  let n = 0;
  for (const r of records.receipts || []) {
    if (r && r.imagePath) {
      storage.deleteReceiptFile(r.imagePath);
      n += 1;
    }
  }
  return n;
}

function wipeStoredFiles({ username, recordsCache }) {
  const haulageFile = auth.recordsFileFor(username);
  const suiteFile = suite.recordsFileFor(username);
  const haulage = loadCachedOrDisk(username, username, haulageFile, recordsCache);
  const suiteKey = `suite:${username}`;
  const suiteRecords = loadCachedOrDisk(username, suiteKey, suiteFile, recordsCache);
  deleteReceiptsFromRecords(haulage);
  deleteReceiptsFromRecords(suiteRecords);
  if (recordsCache) {
    recordsCache.delete(username);
    recordsCache.delete(suiteKey);
  }
  if (fs.existsSync(haulageFile)) fs.unlinkSync(haulageFile);
  if (fs.existsSync(suiteFile)) fs.unlinkSync(suiteFile);
}

async function cancelBillingNow(user) {
  if (!user || !user.stripeSubscriptionId) return { canceled: false };
  try {
    return await billingStripe.cancelSubscriptionImmediately({ user });
  } catch (err) {
    return { canceled: false, error: err.message };
  }
}

/**
 * Wipe login + haulage/suite JSON + receipt files. Refuses the primary mod
 * via auth.deleteUser. Optionally cancels Stripe first.
 */
async function wipeAccount({ username, recordsCache, cancelBilling = true }) {
  const user = auth.getUserRecord(username);
  if (!user) throw httpError("User not found.", 404, "NOT_FOUND");
  let billing = { canceled: false };
  if (cancelBilling) billing = await cancelBillingNow(user);
  wipeStoredFiles({ username: user.username, recordsCache });
  const result = auth.deleteUser(user.username);
  return { ok: true, username: result.username, billing };
}

async function deleteOwnAccount({ username, password, confirm, recordsCache }) {
  if (normalizeConfirm(confirm) !== CONFIRM_WORD) {
    throw httpError(
      "Type DELETE to confirm you want to permanently delete this account.",
      400,
      "CONFIRM_REQUIRED"
    );
  }
  const user = auth.getUser(username);
  if (!user) throw httpError("User not found.", 404, "NOT_FOUND");
  if (user.isAdmin) {
    throw httpError(
      "The primary mod account cannot be deleted from the app.",
      400,
      "PRIMARY_MOD"
    );
  }
  if (!password || !auth.verifyUser(user.username, password)) {
    throw httpError("Current password is incorrect.", 401, "BAD_PASSWORD");
  }
  return wipeAccount({ username: user.username, recordsCache, cancelBilling: true });
}

module.exports = {
  CONFIRM_WORD,
  normalizeConfirm,
  wipeStoredFiles,
  wipeAccount,
  deleteOwnAccount,
  cancelBillingNow,
};
