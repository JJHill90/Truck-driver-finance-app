/**
 * Which saved expenses belong on the general Expenses list.
 * Fuel and car-claim rows stay in that list so they can be seen and deleted.
 * Car Expenses is a narrower view; it does not remove rows from Expenses.
 */
const { isActive, softDeleteEntry } = require("./ledger-lifecycle");

function expenseOnGeneralLedger(entry) {
  return isActive(entry);
}

function generalLedgerExpenses(records) {
  const rows = records && Array.isArray(records.expenses) ? records.expenses : [];
  return rows.filter(expenseOnGeneralLedger);
}

/**
 * Soft-delete by id. Works when the row is missing from the on-screen list
 * (week filter, car-claim filter, or a stale render). Same path as
 * DELETE /expenses/:id and the primary-mod force remove.
 */
function deleteExpenseById(records, id, actor) {
  return softDeleteEntry(records, "expense", id, actor || { username: "test" });
}

module.exports = {
  expenseOnGeneralLedger,
  generalLedgerExpenses,
  deleteExpenseById,
};
