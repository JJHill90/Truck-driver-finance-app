/**
 * Receipts are saved on /receipts/scan before the user Approves.
 * Ledger rows (income/expense) are only created on /receipts/:id/confirm.
 * Gallery shows any receipt with an image — so unconfirmed scans appear as
 * photos with no matching ledger entry.
 */

function hasReceiptImage(receipt) {
  return Boolean(receipt && (receipt.hasImage || receipt.imagePath || receipt.dataUrl));
}

function receiptPurpose(receipt) {
  if (!receipt) return null;
  if (receipt.purpose === "income" || receipt.purpose === "expense") return receipt.purpose;
  if (receipt.linkedIncomeId) return "income";
  if (receipt.linkedExpenseId) return "expense";
  if (receipt.ocrResult?.documentType === "income") return "income";
  return "expense";
}

/**
 * Scan saved to gallery but never approved into the ledger.
 * @param {object} receipt
 * @param {"income"|"expense"} [purpose]
 */
function isAwaitingConfirm(receipt, purpose) {
  if (!hasReceiptImage(receipt)) return false;
  if (receipt.linkedIncomeId || receipt.linkedExpenseId) return false;
  if (receipt.softDeleted || receipt.deletedAt) return false;
  const p = receiptPurpose(receipt);
  if (purpose && p !== purpose) return false;
  return p === "income" || p === "expense";
}

/**
 * Receipt still points at a ledger row that is missing from the active list
 * (typically soft-deleted). Client only sees active income/expenses.
 * @param {object} receipt
 * @param {object[]} activeIncome
 * @param {object[]} activeExpenses
 */
function isMissingLinkedLedger(receipt, activeIncome = [], activeExpenses = []) {
  if (!hasReceiptImage(receipt)) return false;
  if (receipt.linkedIncomeId) {
    const found = (activeIncome || []).some(
      (i) => i && (i.id === receipt.linkedIncomeId || i.receiptId === receipt.id)
    );
    return !found;
  }
  if (receipt.linkedExpenseId) {
    const found = (activeExpenses || []).some(
      (e) => e && (e.id === receipt.linkedExpenseId || e.receiptId === receipt.id)
    );
    return !found;
  }
  return false;
}

function listAwaitingConfirm(receipts, purpose) {
  return (Array.isArray(receipts) ? receipts : []).filter((r) => isAwaitingConfirm(r, purpose));
}

function listMissingLinkedLedger(receipts, activeIncome, activeExpenses, purpose) {
  return (Array.isArray(receipts) ? receipts : []).filter((r) => {
    if (!isMissingLinkedLedger(r, activeIncome, activeExpenses)) return false;
    if (purpose && receiptPurpose(r) !== purpose) return false;
    return true;
  });
}

module.exports = {
  hasReceiptImage,
  receiptPurpose,
  isAwaitingConfirm,
  isMissingLinkedLedger,
  listAwaitingConfirm,
  listMissingLinkedLedger,
};
