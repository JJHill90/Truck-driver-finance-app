/**
 * Profile presets: default work-use % and default expense category.
 * Applied as fallbacks when forms/OCR leave weak/empty values — never
 * overrides a strong vendor/OCR category or an explicit work-use %.
 */

const { normalizeExpenseCategoryId, CAR_CLAIM_CATEGORY_IDS } = require("./expense-menu");
const { isWeakCategory, menuSafeCategory } = require("./vendor-enrichment");

const CAR_CLAIM_ID_SET = new Set(CAR_CLAIM_CATEGORY_IDS);

function clampWorkUsePercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function readPresets(user) {
  const presets = (user && user.presets) || {};
  return {
    defaultWorkUsePercent: clampWorkUsePercent(presets.defaultWorkUsePercent),
    defaultCategory: menuSafeCategory(presets.defaultCategory) || null,
  };
}

/**
 * Apply default expense category when the current value is missing/weak.
 * @returns {boolean} true if category was changed
 */
function applyDefaultCategory(target, user, opts = {}) {
  if (!target || typeof target !== "object") return false;
  const { defaultCategory } = readPresets(user);
  if (!defaultCategory) return false;

  const field = opts.field || "category";
  const current = target[field];
  if (!isWeakCategory(current)) return false;

  target[field] = normalizeExpenseCategoryId(defaultCategory);
  if (opts.sourceField) target[opts.sourceField] = "user_preset";
  return true;
}

/**
 * Apply default work-use % when missing (not when the client sent an explicit %).
 * Skips car-claim categories — those use the active vehicle profile.
 * @returns {boolean} true if work-use was set
 */
function applyDefaultWorkUse(target, user, opts = {}) {
  if (!target || typeof target !== "object") return false;
  const category = opts.category || target.category;
  if (category && CAR_CLAIM_ID_SET.has(normalizeExpenseCategoryId(category))) {
    return false;
  }

  const raw = target.workUsePercent;
  if (raw != null && raw !== "") return false;

  const { defaultWorkUsePercent } = readPresets(user);
  if (defaultWorkUsePercent == null) return false;

  target.workUsePercent = defaultWorkUsePercent;
  if (opts.flagField) target[opts.flagField] = true;
  return true;
}

/**
 * Soft-apply presets onto an expense payload before persist.
 * Category: only when weak. Work-use: only when missing (car claims excluded).
 * (Work-use HTML defaults of 100 are fixed in the UI via form prefill.)
 */
function applyExpensePresets(body, user) {
  if (!body || !user) return body;
  applyDefaultCategory(body, user, { field: "category" });
  applyDefaultWorkUse(body, user);
  return body;
}

/**
 * Soft-apply category preset onto OCR after vendor enrichment when still weak.
 */
function applyOcrCategoryPreset(ocrResult, user) {
  if (!ocrResult || !user) return ocrResult;
  applyDefaultCategory(ocrResult, user, {
    field: "suggestedCategory",
    sourceField: "categorySource",
  });
  return ocrResult;
}

module.exports = {
  clampWorkUsePercent,
  readPresets,
  applyDefaultCategory,
  applyDefaultWorkUse,
  applyExpensePresets,
  applyOcrCategoryPreset,
  isWeakCategory,
};
