/**
 * ABN + business-name enrichment for expense/income scans.
 * Remembers vendors (ABN ↔ name ↔ default category) and uses them as the key
 * reference on later scans, then categorises receipts (meals, training, …).
 */
const storage = require("./storage");
const { vendorsMatch, normalizeVendor } = require("./duplicate-receipt");
const { normalizeExpenseCategoryId, HIDDEN_FROM_MENU } = require("./expense-menu");

const WEAK_CATEGORIES = new Set(["", "other_work", "other", null, undefined]);

/** Heuristic keyword → menu-facing expense category (after meal consolidation). */
const CATEGORY_HEURISTICS = [
  {
    id: "meals",
    re: /\b(breakfast|lunch|dinner|meal|cafe|caf[eé]|restaurant|bistro|mcdonald|hungry\s*jack|kfc|subway|domino|pizza|food\s*court|canteen|roadhouse\s*meal|takeaway|take[\s-]*away)\b/i,
  },
  {
    id: "overtime_meals",
    re: /\b(overtime\s*meal|ot\s*meal)\b/i,
  },
  {
    id: "training_education",
    re: /\b(training|course|seminar|workshop|tafe|rto|certificate|competency|induction|first\s*aid\s*course|driver\s*training|education)\b/i,
  },
  {
    id: "accommodation",
    re: /\b(motel|hotel|accommodation|ibis|quest|room\s*rate|caravan\s*park|lodge|inn\b)\b/i,
  },
  {
    id: "groceries_travel",
    re: /\b(woolworths|coles|aldi|iga|supermarket|grocery|groceries)\b/i,
  },
  {
    id: "rest_facilities",
    re: /\b(shower|laundry|laundromat|rest\s*stop|truck\s*wash\s*bay)\b/i,
  },
  {
    id: "laundry",
    re: /\b(dry[\s-]*clean|clothing\s*laundry|uniform\s*laundry)\b/i,
  },
  {
    id: "clothing_protective",
    re: /\b(hi[\s-]*vis|steel[\s-]*cap|safety\s*boot|protective\s*clothing|ppe|work\s*boot)\b/i,
  },
  {
    id: "clothing_uniform",
    re: /\b(uniform|embroidered\s*shirt|company\s*shirt)\b/i,
  },
  {
    id: "cleaning_supplies",
    re: /\b(truck\s*wash|truck\s*cleaning|vehicle\s*wash|wash\s*bay|detailing)\b/i,
  },
  {
    id: "office_admin",
    re: /\b(logbook|work\s*diary|ewd|electronic\s*work\s*diary|nhvr)\b/i,
  },
  {
    id: "compulsory_assessment",
    re: /\b(medical|vision\s*test|eyesight|health\s*assessment|drug\s*(?:and|&)\s*alcohol)\b/i,
  },
  {
    id: "navigation_comms",
    re: /\b(uhf|gps|navman|two[\s-]*way|phone\s*plan|telstra|optus|vodafone)\b/i,
  },
  {
    id: "tools_equipment",
    re: /\b(bunnings|tool|socket|spanner|torch|flashlight)\b/i,
  },
  {
    id: "incidentals",
    re: /\b(toiletr|incidentals|personal\s*care)\b/i,
  },
  {
    id: "travel_general",
    re: /\b(travel|ferry|flight|airline|bus\s*ticket)\b/i,
  },
];

function normaliseAbn(abn) {
  return String(abn || "")
    .replace(/\s/g, "")
    .replace(/[^\d]/g, "");
}

function formatAbn(digits) {
  const d = normaliseAbn(digits);
  if (d.length !== 11) return d;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}

/** ABN modulus-89 check (Australian Business Register). */
function isValidAbn(abn) {
  const d = normaliseAbn(abn);
  if (d.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = d.split("").map(Number);
  nums[0] -= 1;
  const sum = nums.reduce((s, n, i) => s + n * weights[i], 0);
  return sum % 89 === 0;
}

/** Pull an ABN from OCR text / fields (labeled first, then spaced 11 digits). */
function extractAbnFromText(text) {
  const src = String(text || "");
  const labeled = src.match(/\bABN[:\s#]*([0-9][0-9\s]{9,16}[0-9])/i);
  if (labeled) {
    const d = normaliseAbn(labeled[1]);
    if (d.length === 11) return formatAbn(d);
  }
  const spaced = src.match(/\b(\d{2}\s\d{3}\s\d{3}\s\d{3})\b/);
  if (spaced) {
    const d = normaliseAbn(spaced[1]);
    if (d.length === 11) return formatAbn(d);
  }
  const compact = src.match(/\b(\d{11})\b/);
  if (compact && isValidAbn(compact[1])) return formatAbn(compact[1]);
  return "";
}

function isWeakCategory(id) {
  if (id == null || id === "") return true;
  const norm = normalizeExpenseCategoryId(id);
  return WEAK_CATEGORIES.has(norm) || WEAK_CATEGORIES.has(id);
}

function menuSafeCategory(id) {
  if (!id) return null;
  const norm = normalizeExpenseCategoryId(id);
  if (HIDDEN_FROM_MENU.has(norm)) return null;
  if (WEAK_CATEGORIES.has(norm)) return null;
  return norm;
}

/**
 * Find a remembered vendor by ABN (preferred) or fuzzy business name.
 */
function findKnownVendor(vendors, { vendorAbn, vendor, entity } = {}) {
  const list = vendors || [];
  const abn = normaliseAbn(vendorAbn);
  if (abn && abn.length === 11) {
    const byAbn = list.find((v) => normaliseAbn(v.abn) === abn);
    if (byAbn) return { vendor: byAbn, source: "abn" };
  }
  const name = String(vendor || entity || "").trim();
  if (!name || !normalizeVendor(name)) return null;
  const byName = list.find((v) => vendorsMatch(v.name, name));
  if (byName) return { vendor: byName, source: "name" };
  return null;
}

/** Keyword heuristics on receipt/vendor text → category id. */
function suggestCategoryFromText(text, vendorName = "") {
  const blob = `${vendorName || ""}\n${text || ""}`;
  for (const rule of CATEGORY_HEURISTICS) {
    if (rule.re.test(blob)) {
      const safe = menuSafeCategory(rule.id);
      if (safe) return safe;
    }
  }
  return null;
}

/**
 * Enrich OCR with remembered ABN ↔ business name and a category suggestion.
 * Mutates and returns ocrResult.
 */
function enrichOcrFromVendors(ocrResult, vendors, purpose = "expense") {
  if (!ocrResult || typeof ocrResult !== "object") return ocrResult;
  if (purpose === "income") {
    // Still fill ABN/entity from memory when possible; skip expense categories.
    const raw = ocrResult.rawText || ocrResult.rawTextPreview || "";
    if (!ocrResult.vendorAbn) {
      const fromText = extractAbnFromText(raw);
      if (fromText) ocrResult.vendorAbn = fromText;
    }
    const known = findKnownVendor(vendors, {
      vendorAbn: ocrResult.vendorAbn,
      vendor: ocrResult.vendor || ocrResult.entity || ocrResult.payer,
      entity: ocrResult.entity || ocrResult.payer,
    });
    if (known) {
      if (known.source === "abn" && known.vendor.name) {
        ocrResult.vendor = known.vendor.name;
        ocrResult.entity = ocrResult.entity || known.vendor.name;
        ocrResult.payer = ocrResult.payer || known.vendor.name;
      }
      if (!ocrResult.vendorAbn && known.vendor.abn) {
        ocrResult.vendorAbn = formatAbn(known.vendor.abn);
      }
      ocrResult.vendorId = known.vendor.id;
      ocrResult.vendorMatch = { id: known.vendor.id, source: known.source, name: known.vendor.name };
    }
    return ocrResult;
  }

  const raw = ocrResult.rawText || ocrResult.rawTextPreview || "";
  if (!ocrResult.vendorAbn) {
    const fromText = extractAbnFromText(raw);
    if (fromText) ocrResult.vendorAbn = fromText;
  }

  const known = findKnownVendor(vendors, {
    vendorAbn: ocrResult.vendorAbn,
    vendor: ocrResult.vendor || ocrResult.entity,
    entity: ocrResult.entity,
  });

  if (known) {
    // ABN is the key reference: trust remembered business name when ABN matches.
    if (known.source === "abn" && known.vendor.name) {
      ocrResult.vendor = known.vendor.name;
      if (!ocrResult.entity) ocrResult.entity = known.vendor.name;
    } else if (!ocrResult.vendor && known.vendor.name) {
      ocrResult.vendor = known.vendor.name;
    }
    if (!ocrResult.vendorAbn && known.vendor.abn) {
      ocrResult.vendorAbn = formatAbn(known.vendor.abn);
    } else if (known.vendor.abn && normaliseAbn(ocrResult.vendorAbn) !== normaliseAbn(known.vendor.abn)) {
      // Name matched a known vendor — prefer the stored ABN when OCR ABN missing/invalid.
      if (!isValidAbn(ocrResult.vendorAbn) && isValidAbn(known.vendor.abn)) {
        ocrResult.vendorAbn = formatAbn(known.vendor.abn);
      }
    }
    ocrResult.vendorId = known.vendor.id;
    ocrResult.vendorMatch = {
      id: known.vendor.id,
      source: known.source,
      name: known.vendor.name,
      defaultCategory: known.vendor.defaultCategory || null,
    };
  }

  // Category: remembered vendor default → text heuristics → keep OCR if already strong.
  const remembered = known && menuSafeCategory(known.vendor.defaultCategory);
  const fromText = suggestCategoryFromText(raw, ocrResult.vendor || ocrResult.entity || "");
  const fromOcr = menuSafeCategory(ocrResult.suggestedCategory);

  if (remembered && (isWeakCategory(ocrResult.suggestedCategory) || remembered === fromOcr)) {
    ocrResult.suggestedCategory = remembered;
    ocrResult.categorySource = "vendor_memory";
  } else if (fromText && isWeakCategory(ocrResult.suggestedCategory)) {
    ocrResult.suggestedCategory = fromText;
    ocrResult.categorySource = "text_heuristic";
  } else if (fromOcr) {
    ocrResult.suggestedCategory = fromOcr;
    ocrResult.categorySource = ocrResult.categorySource || "ocr";
  } else if (fromText) {
    ocrResult.suggestedCategory = fromText;
    ocrResult.categorySource = "text_heuristic";
  } else if (remembered) {
    ocrResult.suggestedCategory = remembered;
    ocrResult.categorySource = "vendor_memory";
  } else {
    ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory || "other_work");
  }

  ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory);
  return ocrResult;
}

/**
 * Persist ABN + business name + default category after the driver confirms a save.
 * Extends storage.upsertVendor objects with defaultCategory (no storage.js edit).
 */
function rememberVendor(records, { name, abn, category } = {}) {
  const vendorName = String(name || "").trim();
  if (!vendorName && !normaliseAbn(abn)) return null;

  const vendor = storage.upsertVendor(records, {
    name: vendorName || formatAbn(abn) || "Unknown vendor",
    abn,
  });
  if (!vendor) return null;

  const safe = menuSafeCategory(category);
  if (safe) {
    vendor.defaultCategory = safe;
  }
  vendor.lastUsed = new Date().toISOString();
  return vendor;
}

module.exports = {
  normaliseAbn,
  formatAbn,
  isValidAbn,
  extractAbnFromText,
  findKnownVendor,
  suggestCategoryFromText,
  enrichOcrFromVendors,
  rememberVendor,
  isWeakCategory,
  menuSafeCategory,
};
