/**
 * ABN + business-name enrichment for expense/income scans.
 * Remembers vendors (ABN ↔ name ↔ default category) and uses them as the key
 * reference on later scans, then categorises receipts (meals, training, …).
 *
 * When ABN / business name establish a known business type (e.g. Woolworths →
 * groceries), that type always wins over weak OCR guesses like other_work.
 *
 * Also canonicalises chain names from OCR junk (e.g. "7 EIEVEN" / random first
 * line → "7-Eleven") by matching tolerant patterns against the vendor field and
 * receipt raw text — without editing the verbatim OCR modules.
 */
const storage = require("./storage");
const { vendorsMatch, normalizeVendor } = require("./duplicate-receipt");
const { normalizeExpenseCategoryId, HIDDEN_FROM_MENU } = require("./expense-menu");

const WEAK_CATEGORIES = new Set(["", "other_work", "other", null, undefined]);

/**
 * Receipt header/boilerplate lines that OCR often returns as the "vendor"
 * when the real brand logo is misread.
 */
const VENDOR_BOILERPLATE_RE =
  /^(tax\s*invoice|taxinvoice|invoice|receipt|abn\b|gst\b|total\b|change\b|eftpos|visa|mastercard|debit|credit|thank\s*you|store\s*#?\d+|terminal|merchant\s*copy|customer\s*copy|docket)\b/i;

/**
 * Well-known AU chains → clean display name (+ optional category / ABN).
 * Patterns intentionally tolerate common Tesseract misreads (l/1/I, e/c, …).
 * Order: more specific brands first.
 */
const CANONICAL_VENDORS = [
  {
    name: "7-Eleven",
    // fuel is hidden from the expense menu — name cleanup only
    patterns: [
      /\b7[\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i,
      /\b7[\s-]*eie[vw]en\b/i,
      /\b7[\s-]*el[e]?v[ae]?n\b/i,
      /\b7eleven\b/i,
      /\bseven[\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i,
      // Leading "7" often OCR'd as l, I, |, or 1
      /\b[lI|1][\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i,
      /\b7[\s-]*11\b/,
    ],
    abns: [],
  },
  {
    name: "Woolworths",
    category: "groceries_travel",
    patterns: [/\bwoolworths?\b/i, /\bwoolies\b/i, /\bwoolworth\b/i],
    abns: ["88000014675"],
  },
  {
    name: "Coles",
    category: "groceries_travel",
    patterns: [/\bcoles(?:\s+group|\s+supermarket|\s+express)?\b/i],
    abns: ["45004189708"],
  },
  {
    name: "ALDI",
    category: "groceries_travel",
    patterns: [/\baldi\b/i],
    abns: [],
  },
  {
    name: "BP",
    patterns: [/\bbp\b(?:\s+(?:truck\s*stop|servo|connect|outlet|service))?/i],
    abns: [],
  },
  {
    name: "Shell",
    patterns: [/\bshell\b(?:\s+(?:truck\s*stop|servo))?/i],
    abns: [],
  },
  {
    name: "Ampol",
    patterns: [/\bampol\b/i],
    abns: [],
  },
  {
    name: "Caltex",
    patterns: [/\bcaltex\b/i],
    abns: [],
  },
  {
    name: "United Petroleum",
    patterns: [/\bunited\s*petroleum\b/i, /\bunited\s*servo\b/i],
    abns: [],
  },
  {
    name: "Puma Energy",
    patterns: [/\bpuma(?:\s*energy)?\b/i],
    abns: [],
  },
  {
    name: "Bunnings",
    category: "tools_equipment",
    patterns: [/\bbunnings\b/i],
    abns: ["26008672179"],
  },
  {
    name: "McDonald's",
    category: "meals",
    patterns: [/\bmcdona[l1]d'?s?\b/i, /\bmaccas\b/i],
    abns: [],
  },
  {
    name: "Hungry Jack's",
    category: "meals",
    patterns: [/\bhungry\s*jack'?s?\b/i],
    abns: [],
  },
  {
    name: "KFC",
    category: "meals",
    patterns: [/\bkfc\b/i, /\bkentucky\s*fried\b/i],
    abns: [],
  },
  {
    name: "Subway",
    category: "meals",
    patterns: [/\bsubway\b/i],
    abns: [],
  },
  {
    name: "Telstra",
    category: "navigation_comms",
    patterns: [/\btelstra\b/i],
    abns: ["33051775556"],
  },
  {
    name: "Optus",
    category: "navigation_comms",
    patterns: [/\boptus\b/i],
    abns: [],
  },
];

/**
 * Known Australian retailers / chains → expense category by business type.
 * Matched by ABN (preferred) or business-name wording. Always overrides weak
 * OCR (other_work) and any conflicting remembered default.
 */
const KNOWN_BUSINESS_TYPES = [
  {
    category: "groceries_travel",
    // Supermarkets / grocery chains — not "other work-related expenses"
    nameRe:
      /\b(woolworths|woolies|coles(?:\s+group|\s+supermarket)?|aldi|iga|foodworks|foodland|drakes|harris\s*farm|costco|supermarket|grocery|groceries)\b/i,
    abns: [
      "88000014675", // Woolworths Group Limited
      "45004189708", // Coles Group Limited
    ],
  },
  {
    category: "tools_equipment",
    nameRe:
      /\b(bunnings|total\s*tools|sydney\s*tools|repco|supercheap\s*auto|autobarn|blackwoods|tool\s*kit\s*depot)\b/i,
    abns: [
      "26008672179", // Bunnings Group Limited
    ],
  },
  {
    category: "meals",
    nameRe:
      /\b(mcdonald'?s?|hungry\s*jack'?s?|kfc|subway|domino'?s|pizza\s*hut|red\s*rooster|guzman|grill'?d|nando'?s|oporto|hungry\s*jacks)\b/i,
    abns: [],
  },
  {
    category: "accommodation",
    nameRe:
      /\b(ibis|quest\s+apartment|quest\s+serviced|mercure|novotel|hilton|holiday\s*inn|motel\s+\w+|caravan\s*park)\b/i,
    abns: [],
  },
  {
    category: "navigation_comms",
    nameRe: /\b(telstra|optus|vodafone|boost\s*mobile|amaysim)\b/i,
    abns: [
      "33051775556", // Telstra Corporation Limited
    ],
  },
  {
    category: "cleaning_supplies",
    nameRe: /\b(truck\s*wash|ultra\s*tune\s*wash|pro[\s-]?wash)\b/i,
    abns: [],
  },
];

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
  // Prefer the ABN+entity resolver (checksum + proximity). Fall back to the
  // first valid labeled / spaced / compact hit when pairing finds nothing.
  try {
    const { pickBestAbnCandidate } = require("./abn-entity");
    const picked = pickBestAbnCandidate(src);
    if (picked && picked.best) return picked.best.formatted;
  } catch {
    /* circular-load safe fallback below */
  }
  const labeled = src.match(/\bABN[:\s#]*([0-9][0-9\s]{9,16}[0-9])/i);
  if (labeled) {
    const d = normaliseAbn(labeled[1]);
    if (d.length === 11 && isValidAbn(d)) return formatAbn(d);
  }
  const spaced = src.match(/\b(\d{2}\s\d{3}\s\d{3}\s\d{3})\b/);
  if (spaced) {
    const d = normaliseAbn(spaced[1]);
    if (d.length === 11 && isValidAbn(d)) return formatAbn(d);
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
 * Infer expense category from established business identity (ABN and/or name).
 * Returns a menu-safe category id, or null when the business type is unknown.
 */
function inferBusinessTypeCategory({ name, abn, text } = {}) {
  const abnDigits = normaliseAbn(abn);
  if (abnDigits.length === 11) {
    for (const rule of KNOWN_BUSINESS_TYPES) {
      if ((rule.abns || []).some((a) => normaliseAbn(a) === abnDigits)) {
        return menuSafeCategory(rule.category);
      }
    }
  }
  const blob = `${name || ""}\n${text || ""}`;
  if (!String(blob).trim()) return null;
  for (const rule of KNOWN_BUSINESS_TYPES) {
    if (rule.nameRe && rule.nameRe.test(blob)) {
      return menuSafeCategory(rule.category);
    }
  }
  return null;
}

/**
 * True when OCR "vendor" looks like noise / boilerplate rather than a brand.
 * Examples: "XqR7", "TAX INVOICE", a lone store number, or empty.
 */
function looksLikeJunkVendor(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  if (VENDOR_BOILERPLATE_RE.test(s)) return true;
  if (s.length <= 2) return true;
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 2) return true;
  const norm = normalizeVendor(s);
  if (!norm || norm.length <= 2) return true;
  // Long consonant salad with no vowels (typical Tesseract garbage).
  if (letters.length >= 4) {
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    if (vowels === 0) return true;
  }
  // Mostly non-letters (e.g. "#4821 ***").
  const nonLetterRatio = (s.length - letters.length) / s.length;
  if (s.length >= 4 && nonLetterRatio >= 0.6) return true;
  return false;
}

/** Match a known chain against a single string (vendor field or raw OCR text). */
function matchCanonicalVendorInText(text) {
  const src = String(text || "");
  if (!src.trim()) return null;
  for (const entry of CANONICAL_VENDORS) {
    for (const re of entry.patterns || []) {
      if (re.test(src)) return entry;
    }
  }
  return null;
}

function matchCanonicalVendorByAbn(abn) {
  const digits = normaliseAbn(abn);
  if (digits.length !== 11) return null;
  return (
    CANONICAL_VENDORS.find((entry) =>
      (entry.abns || []).some((a) => normaliseAbn(a) === digits)
    ) || null
  );
}

/**
 * Resolve a clean chain name from OCR vendor + receipt text.
 * Prefers ABN, then a brand already in the vendor field, then a brand found
 * in the receipt header/body when the vendor field is junk or mismatched.
 */
function resolveCanonicalVendor({ vendor, text, abn } = {}) {
  const byAbn = matchCanonicalVendorByAbn(abn);
  if (byAbn) return { ...byAbn, source: "abn" };

  const vendorStr = String(vendor || "").trim();
  const fromVendor = matchCanonicalVendorInText(vendorStr);
  if (fromVendor) return { ...fromVendor, source: "vendor_field" };

  // Only override from receipt text when the vendor field is empty/junk —
  // never replace a plausible independent name with a brand mentioned later
  // on the docket (e.g. a BP card line on another servo's receipt).
  if (!looksLikeJunkVendor(vendorStr)) return null;

  const raw = String(text || "");
  const header = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 24)
    .join("\n");
  const fromHeader = matchCanonicalVendorInText(header) || matchCanonicalVendorInText(raw);
  if (!fromHeader) return null;
  return { ...fromHeader, source: "raw_text" };
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

  // Prefer a clean chain name over OCR first-line junk ("XqR7", "TAX INVOICE").
  const canonical = resolveCanonicalVendor({
    vendor: ocrResult.vendor || ocrResult.entity,
    text: raw,
    abn: ocrResult.vendorAbn,
  });
  if (canonical) {
    if (String(ocrResult.vendor || "").trim() !== canonical.name) {
      ocrResult.vendor = canonical.name;
    }
    ocrResult.vendorCanonical = {
      name: canonical.name,
      source: canonical.source,
    };
    if (!ocrResult.vendorAbn && canonical.abns && canonical.abns[0]) {
      ocrResult.vendorAbn = formatAbn(canonical.abns[0]);
    }
  }

  const known = findKnownVendor(vendors, {
    vendorAbn: ocrResult.vendorAbn,
    vendor: ocrResult.vendor || ocrResult.entity || (canonical && canonical.name),
    entity: ocrResult.entity,
  });

  if (known) {
    // ABN is the key reference: trust remembered business name when ABN matches.
    // Name matches also win when OCR vendor is empty, junk, or the same brand.
    if (known.vendor.name) {
      const prev = String(ocrResult.vendor || "").trim();
      if (
        known.source === "abn" ||
        !prev ||
        looksLikeJunkVendor(prev) ||
        vendorsMatch(prev, known.vendor.name)
      ) {
        ocrResult.vendor = known.vendor.name;
        if (!ocrResult.entity) ocrResult.entity = known.vendor.name;
      }
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

  const businessName = ocrResult.vendor || ocrResult.entity || (known && known.vendor.name) || "";
  const businessAbn = ocrResult.vendorAbn || (known && known.vendor.abn) || "";
  const businessType = inferBusinessTypeCategory({
    name: businessName,
    abn: businessAbn,
    text: raw,
  });

  // Business type (Woolworths → groceries, etc.) always wins once ABN/name
  // establish the retailer — including over OCR other_work and bad memory.
  if (businessType) {
    ocrResult.suggestedCategory = businessType;
    ocrResult.categorySource = "business_type";
    // Heal remembered defaults that contradict the known business type.
    if (known && known.vendor && known.vendor.defaultCategory !== businessType) {
      known.vendor.defaultCategory = businessType;
    }
    return ocrResult;
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
 * Known business types override weak categories so groceries stay groceries.
 */
function rememberVendor(records, { name, abn, category } = {}) {
  const vendorName = String(name || "").trim();
  if (!vendorName && !normaliseAbn(abn)) return null;

  const vendor = storage.upsertVendor(records, {
    name: vendorName || formatAbn(abn) || "Unknown vendor",
    abn,
  });
  if (!vendor) return null;

  const businessType = inferBusinessTypeCategory({
    name: vendor.name || vendorName,
    abn: vendor.abn || abn,
  });
  const safe = menuSafeCategory(category);

  if (businessType) {
    vendor.defaultCategory = businessType;
  } else if (safe) {
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
  inferBusinessTypeCategory,
  enrichOcrFromVendors,
  rememberVendor,
  isWeakCategory,
  menuSafeCategory,
  looksLikeJunkVendor,
  resolveCanonicalVendor,
  matchCanonicalVendorInText,
  KNOWN_BUSINESS_TYPES,
  CANONICAL_VENDORS,
};
