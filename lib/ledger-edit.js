/**
 * In-place updates for expense / income ledger rows.
 * Lives outside storage.js (verbatim) — mutates the records object that
 * server.js already holds in memory and persists via saveRecords.
 */
const { normalizeExpenseCategoryId } = require("./expense-menu");
const { normalizeIncomeTypeId } = require("./income-menu");
const { toIsoAusDate } = require("./aus-date");

function findById(list, id) {
  if (!Array.isArray(list) || !id) return null;
  return list.find((e) => e && e.id === id) || null;
}

function coerceDate(value, fallback) {
  if (value == null || value === "") return fallback;
  return toIsoAusDate(value) || String(value).slice(0, 10) || fallback;
}

function numOr(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Update an existing expense. Preserves id, createdAt, receiptId unless
 * explicitly provided. Returns the updated entry or null if not found.
 */
function updateExpense(records, id, patch = {}) {
  const entry = findById(records && records.expenses, id);
  if (!entry) return null;

  if (patch.date !== undefined) entry.date = coerceDate(patch.date, entry.date);
  if (patch.category !== undefined) {
    entry.category = normalizeExpenseCategoryId(patch.category) || entry.category;
  }
  if (patch.amount !== undefined) entry.amount = numOr(patch.amount, entry.amount);
  if (patch.description !== undefined) entry.description = String(patch.description || "");
  if (patch.vendor !== undefined) entry.vendor = String(patch.vendor || "");
  if (patch.vendorAbn !== undefined || patch.abn !== undefined) {
    entry.vendorAbn = String(patch.vendorAbn || patch.abn || "")
      .replace(/\s/g, "")
      .replace(/[^\d]/g, "");
  }
  if (patch.vendorId !== undefined) entry.vendorId = patch.vendorId || null;
  if (patch.workUsePercent !== undefined) {
    entry.workUsePercent = numOr(patch.workUsePercent, entry.workUsePercent ?? 100);
  }
  if (patch.reimbursed !== undefined) entry.reimbursed = Boolean(patch.reimbursed);
  if (patch.method !== undefined) entry.method = patch.method || null;
  if (patch.kilometres !== undefined) {
    entry.kilometres = patch.kilometres == null || patch.kilometres === "" ? null : numOr(patch.kilometres, null);
  }
  if (patch.laundryLoads !== undefined) {
    entry.laundryLoads =
      patch.laundryLoads == null || patch.laundryLoads === "" ? null : numOr(patch.laundryLoads, null);
  }
  if (patch.laundryMixed !== undefined) entry.laundryMixed = Boolean(patch.laundryMixed);
  if (patch.notes !== undefined) entry.notes = String(patch.notes || "");
  entry.updatedAt = new Date().toISOString();
  return entry;
}

/**
 * Update an existing income entry. Preserves id, createdAt, receiptId.
 */
function updateIncome(records, id, patch = {}) {
  const entry = findById(records && records.income, id);
  if (!entry) return null;

  if (patch.date !== undefined) entry.date = coerceDate(patch.date, entry.date);
  if (patch.type !== undefined) {
    entry.type = normalizeIncomeTypeId(patch.type) || entry.type;
  }
  if (patch.amount !== undefined) entry.amount = numOr(patch.amount, entry.amount);
  if (patch.description !== undefined) entry.description = String(patch.description || "");
  if (patch.payer !== undefined) entry.payer = String(patch.payer || "");
  if (patch.entity !== undefined) {
    entry.entity = String(patch.entity || "");
    if (patch.payer === undefined) entry.payer = entry.entity;
  } else if (patch.payer !== undefined && !entry.entity) {
    entry.entity = entry.payer;
  }
  if (patch.reference !== undefined) entry.reference = String(patch.reference || "");
  if (patch.claimingDeduction !== undefined) {
    entry.claimingDeduction = Boolean(patch.claimingDeduction);
  }
  if (patch.documentKind !== undefined) entry.documentKind = patch.documentKind || null;
  if (patch.grossTotal !== undefined) {
    entry.grossTotal = numOr(patch.grossTotal, entry.grossTotal ?? entry.amount);
  }
  if (patch.taxableIncome !== undefined) {
    entry.taxableIncome = numOr(patch.taxableIncome, entry.taxableIncome ?? entry.amount);
  }
  if (patch.gstAmount !== undefined) entry.gstAmount = numOr(patch.gstAmount, entry.gstAmount ?? 0);
  if (patch.netPay !== undefined) {
    entry.netPay = patch.netPay == null || patch.netPay === "" ? null : numOr(patch.netPay, null);
  }
  if (patch.payPeriod !== undefined) entry.payPeriod = String(patch.payPeriod || "");
  if (patch.summaryNotes !== undefined) entry.summaryNotes = String(patch.summaryNotes || "");
  entry.updatedAt = new Date().toISOString();
  return entry;
}

module.exports = {
  updateExpense,
  updateIncome,
  findById,
};
