/**
 * Aggregate EOFY PDF ledgers into compact category / vendor summaries
 * (avoids listing every transaction on the downloadable working paper).
 */
const { getFinancialYearForDate, getCategoryMeta } = require("./ato-standards");
const { calcIncomeAssessability } = require("./tax-calculator");
const { deductionForYear } = require("./historical-rates");
const { presentExpenseLabel } = require("./report-present");

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

function isActive(entry) {
  return Boolean(entry && !entry.deletedAt);
}

function inFinancialYear(entry, fy) {
  if (!fy) return true;
  return getFinancialYearForDate(entry.date) === fy;
}

function atoScheduleShort(categoryId) {
  const meta = getCategoryMeta(categoryId);
  if (!meta || !meta.atoSchedule) return "—";
  return String(meta.atoSchedule).split(" ")[0];
}

/**
 * One row per expense category for the selected FY (gross + deductible totals).
 */
function summariseExpensesByCategory(expenses, fy) {
  const map = new Map();
  for (const e of expenses || []) {
    if (!isActive(e) || !inFinancialYear(e, fy)) continue;
    const category = e.category || "other_work";
    let row = map.get(category);
    if (!row) {
      row = {
        category,
        label: presentExpenseLabel(category),
        atoSchedule: atoScheduleShort(category),
        count: 0,
        amountTotal: 0,
        deductibleTotal: 0,
        vendingCount: 0,
        cashCount: 0,
        noReceiptCount: 0,
      };
      map.set(category, row);
    }
    row.count += 1;
    row.amountTotal = round2(row.amountTotal + num(e.amount));
    row.deductibleTotal = round2(row.deductibleTotal + deductionForYear(e, fy).deductibleAmount);
    if (e.vendingMachine) row.vendingCount += 1;
    if (e.cashTransaction) row.cashCount += 1;
    if (e.noReceipt) row.noReceiptCount += 1;
  }

  return [...map.values()].sort((a, b) =>
    String(a.label).localeCompare(String(b.label), "en", { sensitivity: "base" })
  );
}

function incomeVendorName(entry) {
  const name = String((entry && (entry.payer || entry.entity || entry.vendor)) || "").trim();
  return name || "—";
}

/**
 * One row per income vendor/payer for the selected FY, with a roaming
 * (running) assessable total in display order.
 */
function summariseIncomeByVendor(income, fy) {
  const map = new Map();
  for (const i of income || []) {
    if (!isActive(i) || !inFinancialYear(i, fy)) continue;
    const vendor = incomeVendorName(i);
    let row = map.get(vendor);
    if (!row) {
      row = {
        vendor,
        count: 0,
        grossTotal: 0,
        assessableTotal: 0,
      };
      map.set(vendor, row);
    }
    const gross = num(i.grossTotal != null ? i.grossTotal : i.amount);
    const assessable = calcIncomeAssessability(i).assessable;
    row.count += 1;
    row.grossTotal = round2(row.grossTotal + gross);
    row.assessableTotal = round2(row.assessableTotal + assessable);
  }

  const rows = [...map.values()].sort((a, b) =>
    String(a.vendor).localeCompare(String(b.vendor), "en", { sensitivity: "base" })
  );

  let running = 0;
  for (const row of rows) {
    running = round2(running + row.assessableTotal);
    row.runningTotal = running;
  }
  return rows;
}

module.exports = {
  summariseExpensesByCategory,
  summariseIncomeByVendor,
  incomeVendorName,
  round2,
};
