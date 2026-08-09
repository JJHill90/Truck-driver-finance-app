/**
 * Ledger reconciliation + soft-delete lifecycle for expenses / income.
 * Lives outside storage.js (verbatim) — mutates the in-memory records object.
 *
 * Fields on each expense/income row:
 *   reconciled, reconciledAt, reconciledBy
 *   deletedAt, deletedBy
 */

function listKey(type) {
  if (type === "expense" || type === "expenses") return "expenses";
  if (type === "income") return "income";
  throw new Error("type must be expense or income");
}

function isDeleted(entry) {
  return Boolean(entry && entry.deletedAt);
}

function isReconciled(entry) {
  return Boolean(entry && entry.reconciled && !isDeleted(entry));
}

function isActive(entry) {
  return Boolean(entry && entry.id && !isDeleted(entry));
}

function activeEntries(list) {
  return (Array.isArray(list) ? list : []).filter(isActive);
}

/** Shallow clone of records with only active expenses/income (for tax/UI). */
function withActiveLedger(records) {
  if (!records || typeof records !== "object") return records;
  return {
    ...records,
    expenses: activeEntries(records.expenses),
    income: activeEntries(records.income),
  };
}

function findEntry(records, type, id) {
  const key = listKey(type);
  const list = records && records[key];
  if (!Array.isArray(list) || !id) return null;
  return list.find((e) => e && e.id === id) || null;
}

function normaliseIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

/**
 * Mark entries reconciled. Skips missing/deleted rows.
 * @returns {{ updated: object[], skipped: string[], notFound: string[] }}
 */
function reconcileEntries(records, type, ids, { username } = {}) {
  const now = new Date().toISOString();
  const by = username ? String(username) : null;
  const updated = [];
  const skipped = [];
  const notFound = [];

  for (const id of normaliseIds(ids)) {
    const entry = findEntry(records, type, id);
    if (!entry) {
      notFound.push(id);
      continue;
    }
    if (isDeleted(entry)) {
      skipped.push(id);
      continue;
    }
    entry.reconciled = true;
    entry.reconciledAt = now;
    entry.reconciledBy = by;
    entry.updatedAt = now;
    updated.push(entry);
  }
  return { updated, skipped, notFound };
}

/**
 * Clear reconcile lock (admin override).
 */
function unreconcileEntries(records, type, ids, { username } = {}) {
  const now = new Date().toISOString();
  const updated = [];
  const notFound = [];

  for (const id of normaliseIds(ids)) {
    const entry = findEntry(records, type, id);
    if (!entry) {
      notFound.push(id);
      continue;
    }
    entry.reconciled = false;
    entry.reconciledAt = null;
    entry.reconciledBy = null;
    entry.unreconciledAt = now;
    entry.unreconciledBy = username ? String(username) : null;
    entry.updatedAt = now;
    updated.push(entry);
  }
  return { updated, notFound };
}

/**
 * Soft-delete an entry. Fails if reconciled unless force is true.
 * @returns {{ ok: boolean, entry?: object, error?: string, code?: string }}
 */
function softDeleteEntry(records, type, id, { username, force = false } = {}) {
  const entry = findEntry(records, type, id);
  if (!entry) return { ok: false, error: "Entry not found.", code: "not_found" };
  if (isDeleted(entry)) return { ok: false, error: "Entry already deleted.", code: "already_deleted" };
  if (isReconciled(entry) && !force) {
    return {
      ok: false,
      error: "This entry is reconciled and cannot be deleted. Ask the primary mod to unlock it first.",
      code: "reconciled",
      entry,
    };
  }
  const now = new Date().toISOString();
  entry.deletedAt = now;
  entry.deletedBy = username ? String(username) : null;
  entry.updatedAt = now;
  return { ok: true, entry };
}

/**
 * Restore a soft-deleted entry (admin). Does not change reconcile flags.
 */
function restoreEntry(records, type, id, { username } = {}) {
  const entry = findEntry(records, type, id);
  if (!entry) return { ok: false, error: "Entry not found.", code: "not_found" };
  if (!isDeleted(entry)) return { ok: false, error: "Entry is not deleted.", code: "not_deleted", entry };
  const now = new Date().toISOString();
  entry.deletedAt = null;
  entry.deletedBy = null;
  entry.restoredAt = now;
  entry.restoredBy = username ? String(username) : null;
  entry.updatedAt = now;
  return { ok: true, entry };
}

function assertEditable(entry) {
  if (!entry) return { ok: false, error: "Entry not found.", code: "not_found" };
  if (isDeleted(entry)) return { ok: false, error: "Entry is deleted.", code: "deleted" };
  if (isReconciled(entry)) {
    return {
      ok: false,
      error: "This entry is reconciled and cannot be edited. Ask the primary mod to unlock it first.",
      code: "reconciled",
    };
  }
  return { ok: true };
}

module.exports = {
  listKey,
  isDeleted,
  isReconciled,
  isActive,
  activeEntries,
  withActiveLedger,
  findEntry,
  reconcileEntries,
  unreconcileEntries,
  softDeleteEntry,
  restoreEntry,
  assertEditable,
};
