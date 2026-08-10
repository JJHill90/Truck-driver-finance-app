/**
 * Per-user records snapshots so Haulage_Admin can restore a driver's data
 * after mistakes, bad edits, or accidental loss.
 *
 * Snapshots live under data/history/<username>/ (git-ignored with data/).
 * storage.js stays untouched — callers snapshot before saveRecords.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const HISTORY_ROOT = path.join(DATA_DIR, "history");
const MAX_SNAPSHOTS = 40;

function safeUserKey(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_") || "unknown";
}

function historyDirFor(username) {
  return path.join(HISTORY_ROOT, safeUserKey(username));
}

function ensureDir(username) {
  fs.mkdirSync(historyDirFor(username), { recursive: true });
}

function cloneRecords(records) {
  return JSON.parse(JSON.stringify(records || {}));
}

function contentHash(records) {
  return crypto.createHash("sha256").update(JSON.stringify(records || {})).digest("hex").slice(0, 20);
}

function summariseCounts(records) {
  return {
    expenses: Array.isArray(records?.expenses) ? records.expenses.length : 0,
    income: Array.isArray(records?.income) ? records.income.length : 0,
    receipts: Array.isArray(records?.receipts) ? records.receipts.length : 0,
  };
}

function snapshotPath(username, id) {
  return path.join(historyDirFor(username), `${id}.json`);
}

function makeSnapshotId(date = new Date()) {
  const iso = date.toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(3).toString("hex");
  return `${iso}_${rand}`;
}

function listSnapshotFiles(username) {
  const dir = historyDirFor(username);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(dir, name))
    .sort()
    .reverse();
}

function pruneSnapshots(username) {
  const files = listSnapshotFiles(username);
  for (const file of files.slice(MAX_SNAPSHOTS)) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Write a snapshot of the current records (before an upcoming mutation).
 * Skips when content matches the newest snapshot (no-op saves).
 * @returns {{ id: string, savedAt: string, skipped?: boolean } | null}
 */
function snapshotRecords(username, records, { reason = "auto", actor = null } = {}) {
  if (!username) return null;
  ensureDir(username);
  const payload = cloneRecords(records);
  const hash = contentHash(payload);
  const newest = listSnapshotFiles(username)[0];
  if (newest) {
    try {
      const prev = JSON.parse(fs.readFileSync(newest, "utf8"));
      if (prev && prev.hash === hash) {
        return { id: prev.id, savedAt: prev.savedAt, skipped: true, hash };
      }
    } catch {
      /* write a fresh snapshot */
    }
  }

  const id = makeSnapshotId();
  const savedAt = new Date().toISOString();
  const doc = {
    id,
    savedAt,
    reason: String(reason || "auto"),
    actor: actor ? String(actor) : null,
    hash,
    counts: summariseCounts(payload),
    profileName: payload.profile?.name || "",
    financialYear: payload.profile?.financialYear || null,
    records: payload,
  };
  fs.writeFileSync(snapshotPath(username, id), JSON.stringify(doc), "utf8");
  pruneSnapshots(username);
  return { id, savedAt, hash, skipped: false };
}

function listSnapshots(username, { limit = 30 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 30, 1), MAX_SNAPSHOTS);
  const out = [];
  for (const file of listSnapshotFiles(username)) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      out.push({
        id: doc.id,
        savedAt: doc.savedAt,
        reason: doc.reason || "auto",
        actor: doc.actor || null,
        counts: doc.counts || summariseCounts(doc.records),
        profileName: doc.profileName || doc.records?.profile?.name || "",
        financialYear: doc.financialYear || doc.records?.profile?.financialYear || null,
        hash: doc.hash || null,
      });
      if (out.length >= max) break;
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

function readSnapshot(username, id) {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeId) return null;
  const file = snapshotPath(username, safeId);
  if (!fs.existsSync(file)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!doc || !doc.records) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Load a snapshot's records clone for restore.
 * @returns {{ records: object, meta: object } | null}
 */
function loadSnapshotRecords(username, id) {
  const doc = readSnapshot(username, id);
  if (!doc) return null;
  return {
    records: cloneRecords(doc.records),
    meta: {
      id: doc.id,
      savedAt: doc.savedAt,
      reason: doc.reason,
      actor: doc.actor,
      counts: doc.counts,
    },
  };
}

module.exports = {
  MAX_SNAPSHOTS,
  HISTORY_ROOT,
  snapshotRecords,
  listSnapshots,
  readSnapshot,
  loadSnapshotRecords,
  contentHash,
  summariseCounts,
  historyDirFor,
};
