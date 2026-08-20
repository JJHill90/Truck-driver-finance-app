/**
 * Admin (and assist) move of ledger rows between expenses ↔ income.
 * Soft-deletes the source row and creates a new opposite-type entry,
 * rewiring any linked receipt purpose/ids. Does not edit storage.js.
 */
const storage = require("./storage");
const { softDeleteEntry, findEntry, isDeleted, unreconcileEntries } = require("./ledger-lifecycle");
const { normalizeExpenseCategoryId } = require("./expense-menu");
const { normalizeIncomeTypeId } = require("./income-menu");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function findReceipt(records, receiptId) {
  if (!receiptId || !Array.isArray(records.receipts)) return null;
  return records.receipts.find((r) => r && r.id === receiptId) || null;
}

function rewireReceipt(records, receiptId, { purpose, newEntryId, clearExpense, clearIncome }) {
  const receipt = findReceipt(records, receiptId);
  if (!receipt) return null;
  if (purpose) receipt.purpose = purpose;
  if (clearExpense) receipt.linkedExpenseId = null;
  if (clearIncome) receipt.linkedIncomeId = null;
  if (purpose === "income") {
    receipt.linkedIncomeId = newEntryId;
    receipt.linkedExpenseId = null;
  } else if (purpose === "expense") {
    receipt.linkedExpenseId = newEntryId;
    receipt.linkedIncomeId = null;
  }
  return receipt;
}

function expenseToIncomePayload(expense) {
  const amount = round2(num(expense.amount));
  const entity = String(expense.vendor || expense.description || "").trim();
  const notesBits = [
    expense.notes && String(expense.notes),
    expense.vendorAbn && `ABN ${expense.vendorAbn}`,
    expense.category && `Moved from expense category ${expense.category}`,
  ].filter(Boolean);
  return {
    date: expense.date,
    type: normalizeIncomeTypeId("salary_wages") || "salary_wages",
    amount,
    description: expense.description || expense.vendor || "Moved from expenses",
    payer: entity,
    entity,
    receiptId: expense.receiptId || null,
    documentKind: null,
    grossTotal: amount,
    taxableIncome: amount,
    gstAmount: 0,
    netPay: amount,
    payPeriod: "",
    summaryNotes: notesBits.join(" · "),
    claimingDeduction: false,
  };
}

function incomeToExpensePayload(income) {
  const amount = round2(
    num(income.amount != null ? income.amount : income.grossTotal != null ? income.grossTotal : 0)
  );
  const vendor = String(income.entity || income.payer || "").trim();
  const notesBits = [
    income.summaryNotes && String(income.summaryNotes),
    income.type && `Moved from income type ${income.type}`,
    income.reference && `Ref ${income.reference}`,
  ].filter(Boolean);
  return {
    date: income.date,
    category: normalizeExpenseCategoryId("other_work") || "other_work",
    amount,
    description: income.description || vendor || "Moved from income",
    vendor,
    vendorAbn: "",
    workUsePercent: 100,
    reimbursed: false,
    receiptId: income.receiptId || null,
    notes: notesBits.join(" · "),
  };
}

/**
 * Move one entry from expenses → income or income → expenses.
 * @returns {{ ok: true, from: object, to: object, receipt: object|null } | { ok: false, error: string, code: string }}
 */
function moveEntry(records, fromType, id, { username } = {}) {
  const sourceType = fromType === "income" ? "income" : "expense";
  const destType = sourceType === "expense" ? "income" : "expense";
  const source = findEntry(records, sourceType, id);
  if (!source) {
    return { ok: false, error: "Entry not found.", code: "not_found" };
  }
  if (isDeleted(source)) {
    return { ok: false, error: "Restore the entry before moving it.", code: "deleted" };
  }

  // Unlock reconciled rows so soft-delete can proceed under force.
  if (source.reconciled) {
    unreconcileEntries(records, sourceType, [source.id], { username });
  }

  const actor = username ? String(username) : null;
  const now = new Date().toISOString();
  let created;

  if (sourceType === "expense") {
    created = storage.addIncome(records, expenseToIncomePayload(source));
  } else {
    created = storage.addExpense(records, incomeToExpensePayload(source));
  }

  created.movedFromId = source.id;
  created.movedFromType = sourceType;
  created.adminMovedAt = now;
  created.adminMovedBy = actor;
  created.updatedAt = now;

  const receiptId = source.receiptId || null;
  // Soft-delete source and clear its receipt link so galleries don't double-bind.
  source.receiptId = null;
  const del = softDeleteEntry(records, sourceType, source.id, {
    username: actor,
    force: true,
  });
  if (!del.ok) {
    // Roll back the created row if soft-delete somehow failed.
    const key = destType === "income" ? "income" : "expenses";
    const list = records[key] || [];
    const idx = list.findIndex((e) => e && e.id === created.id);
    if (idx >= 0) list.splice(idx, 1);
    return { ok: false, error: del.error || "Could not soft-delete source.", code: del.code || "delete_failed" };
  }

  let receipt = null;
  if (receiptId) {
    receipt = rewireReceipt(records, receiptId, {
      purpose: destType,
      newEntryId: created.id,
    });
    created.receiptId = receiptId;
  }

  return { ok: true, from: source, to: created, receipt };
}

/**
 * Move many entries of the same source type to the opposite ledger.
 */
function moveEntries(records, fromType, ids, { username } = {}) {
  const moved = [];
  const errors = [];
  const list = Array.isArray(ids) ? ids : [];
  for (const id of list) {
    const result = moveEntry(records, fromType, id, { username });
    if (result.ok) moved.push({ from: result.from, to: result.to, receiptId: result.receipt && result.receipt.id });
    else errors.push({ id, error: result.error, code: result.code });
  }
  return { moved, errors, movedCount: moved.length };
}

module.exports = {
  moveEntry,
  moveEntries,
  expenseToIncomePayload,
  incomeToExpensePayload,
};
