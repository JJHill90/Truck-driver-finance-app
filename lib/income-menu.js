/**
 * Income type menu for dropdowns: hide unused allowance entries while keeping
 * lib/ato-standards.js verbatim (tax calc still understands legacy ids).
 */
const { listIncomeTypes } = require("./ato-standards");

const HIDDEN_FROM_INCOME_MENU = new Set([
  "allowance_taxable",
  "allowance_travel",
  "allowance_overtime_meal",
]);

/** Fallback when OCR suggests a hidden allowance type. */
const DEFAULT_INCOME_TYPE = "salary_wages";

function listMenuIncomeTypes() {
  return listIncomeTypes().filter((t) => !HIDDEN_FROM_INCOME_MENU.has(t.id));
}

function normalizeIncomeTypeId(typeId) {
  if (!typeId) return typeId;
  if (HIDDEN_FROM_INCOME_MENU.has(typeId)) return DEFAULT_INCOME_TYPE;
  return typeId;
}

module.exports = {
  HIDDEN_FROM_INCOME_MENU,
  DEFAULT_INCOME_TYPE,
  listMenuIncomeTypes,
  normalizeIncomeTypeId,
};
