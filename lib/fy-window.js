/**
 * Australian financial-year picker window.
 *
 * The top-bar / profile / ledger FY dropdowns show:
 *   6 past FYs + current FY + 3 future FYs
 * relative to “today”. The window slides automatically each 1 July —
 * no stored catalog of years is required.
 */

const FY_YEARS_BACK = 6;
const FY_YEARS_FORWARD = 3;

function formatFinancialYearValue(startYear) {
  const y = Math.floor(Number(startYear));
  return `${y}-${String(y + 1).slice(-2)}`;
}

/** Australian FY start year for a Date (Jul–Jun). */
function financialYearStartYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed; July = 6
  return month >= 6 ? year : year - 1;
}

function getCurrentFinancialYear(date = new Date()) {
  return formatFinancialYearValue(financialYearStartYear(date));
}

/**
 * Build FY labels from newest (future) to oldest (past).
 * @param {{ yearsBack?: number, yearsForward?: number, now?: Date }} [opts]
 * @returns {string[]} e.g. ["2029-30", …, "2026-27", …, "2023-24"]
 */
function buildFinancialYearWindow(opts = {}) {
  const yearsBack = opts.yearsBack != null ? opts.yearsBack : FY_YEARS_BACK;
  const yearsForward = opts.yearsForward != null ? opts.yearsForward : FY_YEARS_FORWARD;
  const now = opts.now || new Date();
  const currentStart = financialYearStartYear(now);
  const years = [];
  for (let y = currentStart + yearsForward; y >= currentStart - yearsBack; y -= 1) {
    years.push(formatFinancialYearValue(y));
  }
  return years;
}

function isFinancialYearInWindow(fy, opts = {}) {
  const years = buildFinancialYearWindow(opts);
  return years.includes(String(fy || ""));
}

/**
 * Ensure `selectedFy` appears in the window list (sorted newest-first) even if
 * it sits outside ±N — keeps an existing profile selection selectable.
 */
function ensureSelectedFinancialYear(years, selectedFy) {
  const list = Array.isArray(years) ? years.slice() : [];
  const fy = String(selectedFy || "");
  if (fy && !list.includes(fy)) {
    list.push(fy);
    list.sort((a, b) => Number(b.split("-")[0]) - Number(a.split("-")[0]));
  }
  return list;
}

module.exports = {
  FY_YEARS_BACK,
  FY_YEARS_FORWARD,
  formatFinancialYearValue,
  financialYearStartYear,
  getCurrentFinancialYear,
  buildFinancialYearWindow,
  isFinancialYearInWindow,
  ensureSelectedFinancialYear,
};
