/**
 * Read-only accountant share links for an EOFY pack.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDataDir } = require("./data-dir");
const { writeJsonAtomic } = require("./atomic-write");

const DEFAULT_TTL_DAYS = 90;

function indexFile() {
  return path.join(getDataDir(), "accountant-shares.json");
}

function loadIndex() {
  try {
    if (fs.existsSync(indexFile())) {
      const data = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
      if (data && typeof data === "object" && data.shares && typeof data.shares === "object") {
        return data;
      }
    }
  } catch {
    /* fall through */
  }
  return { shares: {} };
}

function saveIndex(data) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  writeJsonAtomic(indexFile(), data);
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function expiryIso(days = DEFAULT_TTL_DAYS, now = new Date()) {
  const ms = Math.max(1, Number(days) || DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms).toISOString();
}

function isExpired(share, now = new Date()) {
  if (!share || !share.expiresAt) return false;
  const end = new Date(share.expiresAt).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

function isActive(share, now = new Date()) {
  if (!share || share.revokedAt) return false;
  return !isExpired(share, now);
}

function listShares(records) {
  return Array.isArray(records && records.accountantShares) ? records.accountantShares : [];
}

function createShare({ records, username, product, financialYear, createdBy, ttlDays }) {
  const fy = String(financialYear || (records.profile && records.profile.financialYear) || "").trim();
  if (!fy) {
    const err = new Error("Choose a financial year before creating a share link.");
    err.code = "FY_REQUIRED";
    throw err;
  }
  const now = new Date();
  const share = {
    token: newToken(),
    financialYear: fy,
    createdAt: now.toISOString(),
    createdBy: createdBy || username || null,
    expiresAt: expiryIso(ttlDays, now),
    revokedAt: null,
  };
  records.accountantShares = [share, ...listShares(records)].slice(0, 20);
  const index = loadIndex();
  index.shares[share.token] = {
    token: share.token,
    username,
    product: product === "suite" ? "suite" : "haulage",
    financialYear: fy,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: null,
  };
  saveIndex(index);
  return share;
}

function revokeShare({ records, token }) {
  const key = String(token || "").trim();
  if (!key) {
    const err = new Error("Missing share token.");
    err.code = "TOKEN_REQUIRED";
    throw err;
  }
  const now = new Date().toISOString();
  let found = false;
  for (const share of listShares(records)) {
    if (share.token === key) {
      share.revokedAt = now;
      found = true;
    }
  }
  const index = loadIndex();
  if (index.shares[key]) {
    index.shares[key].revokedAt = now;
    found = true;
    saveIndex(index);
  }
  if (!found) {
    const err = new Error("Share link not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  return { token: key, revokedAt: now };
}

function lookupShare(token, now = new Date()) {
  const key = String(token || "").trim();
  if (!key) return null;
  const index = loadIndex();
  const meta = index.shares[key];
  if (!isActive(meta, now)) return null;
  return meta;
}

function publicSharePath(product, token) {
  const prefix = product === "suite" ? "/suite" : "/haulage";
  return `${prefix}/share/${encodeURIComponent(token)}`;
}

module.exports = {
  DEFAULT_TTL_DAYS,
  listShares,
  createShare,
  revokeShare,
  lookupShare,
  isActive,
  publicSharePath,
};
