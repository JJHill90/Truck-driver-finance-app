/**
 * Retroactively fix junk / empty vendor names on old ledger rows using the
 * receipt scan already attached (stored OCR text first; optional re-OCR of the
 * image when text is missing or the caller asks for a rescan).
 *
 * Safety:
 * - Only touches rows whose current vendor is empty, junk, or an OCR shred.
 * - Only writes when enrichment produces a confident, human-readable name.
 * - Never invents a vendor when the scan still cannot identify the shop.
 * - Soft-updates weak expense categories (`other_work`) when enrichment has a
 *   strong business-type category; leaves strong categories alone.
 */

const storage = require("./storage");
const { extractReceiptData } = require("./receipt-ocr");
const { ocrPdfViaRaster, pdfResultNeedsOcr } = require("./pdf-ocr");
const {
  enrichOcrFromVendors,
  rememberVendor,
  looksLikeJunkVendor,
  looksLikeOcrShredVendor,
  isWeakCategory,
} = require("./vendor-enrichment");
const { isDeleted } = require("./ledger-lifecycle");

function entryVendor(entry) {
  return String((entry && (entry.vendor || entry.entity || entry.payer)) || "").trim();
}

/** True when the ledger vendor should be considered for repair. */
function needsVendorRepair(entry) {
  if (!entry || isDeleted(entry)) return false;
  const v = entryVendor(entry);
  if (!v) return true;
  return looksLikeJunkVendor(v) || looksLikeOcrShredVendor(v);
}

function isConfidentVendor(name) {
  const s = String(name || "").trim();
  if (!s) return false;
  return !looksLikeJunkVendor(s) && !looksLikeOcrShredVendor(s);
}

function isPdfReceipt(receipt) {
  const mt = String((receipt && receipt.mimeType) || "").toLowerCase();
  return mt.includes("pdf") || /\.pdf$/i.test((receipt && receipt.filename) || "");
}

/**
 * Build a seed OCR object from stored receipt data and/or a fresh re-scan.
 * Mutates receipt.ocrResult when re-OCR recovers usable raw text.
 */
async function ocrSeedFromReceipt(receipt, purpose, openai, { reOcr = false } = {}) {
  if (!receipt) return null;
  const stored = receipt.ocrResult || {};
  const storedRaw = String(stored.rawText || stored.rawTextPreview || "").trim();
  const seed = {
    vendor: stored.vendor || "",
    entity: stored.entity || "",
    payer: stored.payer || "",
    vendorAbn: stored.vendorAbn || "",
    suggestedCategory: stored.suggestedCategory || "",
    suggestedIncomeType: stored.suggestedIncomeType || null,
    rawText: storedRaw,
    date: stored.date || null,
    lineItems: Array.isArray(stored.lineItems) ? stored.lineItems : [],
  };

  const textUsable = storedRaw.length >= 12;
  if (!reOcr && textUsable) return seed;

  // Short / missing text: try re-OCR when requested, or when there is no text
  // at all but an image exists (otherwise we cannot improve anything).
  const shouldRescan = reOcr || (!storedRaw && Boolean(receipt.imagePath));
  if (!shouldRescan) return seed;

  if (!receipt.imagePath) return seed;

  const dataUrl = storage.readReceiptImage(receipt.imagePath);
  if (!dataUrl) return seed;

  const mimeType =
    receipt.mimeType || (isPdfReceipt(receipt) ? "application/pdf" : "image/jpeg");

  let ocr = null;
  try {
    ocr = await extractReceiptData(openai, dataUrl, mimeType, receipt.filename || "", {
      purpose,
    });
  } catch {
    ocr = null;
  }

  if (isPdfReceipt(receipt) && (!ocr || pdfResultNeedsOcr(ocr, purpose))) {
    try {
      const raster = await ocrPdfViaRaster(dataUrl, { purpose });
      if (raster) {
        ocr = {
          ...(ocr || {}),
          ...raster,
          rawText: raster.rawText || (ocr && ocr.rawText) || "",
          vendor: raster.vendor || (ocr && ocr.vendor) || "",
          vendorAbn: raster.vendorAbn || (ocr && ocr.vendorAbn) || "",
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (!ocr) return seed;

  const mergedRaw = String(ocr.rawText || ocr.rawTextPreview || seed.rawText || "").trim();
  seed.rawText = mergedRaw || seed.rawText;
  if (ocr.vendor && !seed.vendor) seed.vendor = ocr.vendor;
  if (ocr.entity && !seed.entity) seed.entity = ocr.entity;
  if (ocr.vendorAbn && !seed.vendorAbn) seed.vendorAbn = ocr.vendorAbn;
  if (ocr.suggestedCategory && isWeakCategory(seed.suggestedCategory)) {
    seed.suggestedCategory = ocr.suggestedCategory;
  }
  if (Array.isArray(ocr.lineItems) && ocr.lineItems.length) {
    seed.lineItems = ocr.lineItems;
  }

  receipt.ocrResult = receipt.ocrResult || {};
  if (mergedRaw && !receipt.ocrResult.rawText) {
    receipt.ocrResult.rawText = mergedRaw;
  }
  if (ocr.vendorAbn && !receipt.ocrResult.vendorAbn) {
    receipt.ocrResult.vendorAbn = ocr.vendorAbn;
  }

  return seed;
}

/**
 * Propose a confident vendor (and optional category) for one ledger entry.
 * Does not mutate the entry; may enrich receipt.ocrResult raw text on re-OCR.
 */
async function proposeVendorRepair(entry, receipt, purpose, vendors, openai, opts = {}) {
  if (!needsVendorRepair(entry) || !receipt) {
    return { ok: false, reason: "not_eligible" };
  }

  const seed = await ocrSeedFromReceipt(receipt, purpose, openai, opts);
  if (!seed || (!seed.rawText && !seed.vendorAbn && !seed.vendor)) {
    return { ok: false, reason: "no_scan_text" };
  }

  // Prefer the junk ledger name only as a weak hint; enrichment prefers raw text.
  const ocrResult = {
    vendor: seed.vendor || entryVendor(entry),
    entity: seed.entity || "",
    payer: seed.payer || "",
    vendorAbn: seed.vendorAbn || entry.vendorAbn || "",
    suggestedCategory: seed.suggestedCategory || entry.category || "",
    rawText: seed.rawText || "",
    lineItems: seed.lineItems || [],
  };

  enrichOcrFromVendors(ocrResult, vendors, purpose);

  const proposed = String(ocrResult.vendor || ocrResult.entity || "").trim();
  if (!isConfidentVendor(proposed) || ocrResult.vendorNeedsInput) {
    return {
      ok: false,
      reason: "still_unidentified",
      proposed: proposed || "",
      vendorNeedsInput: Boolean(ocrResult.vendorNeedsInput),
    };
  }

  const from = entryVendor(entry);
  if (from && from.toLowerCase() === proposed.toLowerCase()) {
    return { ok: false, reason: "unchanged", proposed };
  }

  const change = {
    ok: true,
    id: entry.id,
    purpose,
    receiptId: receipt.id,
    from: from || "",
    to: proposed,
    vendorAbn: ocrResult.vendorAbn || entry.vendorAbn || "",
    source: ocrResult.vendorCanonical
      ? ocrResult.vendorCanonical.source || "canonical"
      : ocrResult.vendorMatch
        ? ocrResult.vendorMatch.source || "memory"
        : "enrichment",
  };

  if (
    purpose === "expense" &&
    isWeakCategory(entry.category) &&
    ocrResult.suggestedCategory &&
    !isWeakCategory(ocrResult.suggestedCategory)
  ) {
    change.categoryFrom = entry.category || "";
    change.categoryTo = ocrResult.suggestedCategory;
  }

  return change;
}

function applyVendorRepair(entry, receipt, change, records) {
  if (!change || !change.ok || !entry) return;
  entry.vendor = change.to;
  if (entry.entity !== undefined || change.purpose === "income") {
    entry.entity = change.to;
  }
  if (entry.payer !== undefined || change.purpose === "income") {
    entry.payer = change.to;
  }
  if (change.vendorAbn) entry.vendorAbn = change.vendorAbn;
  if (change.categoryTo) entry.category = change.categoryTo;

  if (receipt) {
    receipt.ocrResult = receipt.ocrResult || {};
    receipt.ocrResult.vendor = change.to;
    receipt.ocrResult.entity = change.to;
    if (change.vendorAbn) receipt.ocrResult.vendorAbn = change.vendorAbn;
    receipt.ocrResult.vendorNeedsInput = false;
    if (change.categoryTo) receipt.ocrResult.suggestedCategory = change.categoryTo;
  }

  rememberVendor(records, {
    name: change.to,
    abn: change.vendorAbn,
    category: change.categoryTo || entry.category,
  });
}

/**
 * Scan expenses (+ income) for junk vendors and repair from attached receipts.
 *
 * @returns {Promise<{
 *   examined: number,
 *   eligible: number,
 *   updated: number,
 *   skipped: number,
 *   rescanned: number,
 *   dryRun: boolean,
 *   details: Array
 * }>}
 */
async function repairVendorsFromScans(records, options = {}) {
  const {
    openai = null,
    dryRun = false,
    reOcr = false,
    limit = 0,
    types = ["expense", "income"],
  } = options;

  const receiptsById = new Map((records.receipts || []).map((r) => [r.id, r]));
  const vendors = storage.listVendors(records);
  const typeSet = new Set(types);

  let examined = 0;
  let eligible = 0;
  let updated = 0;
  let skipped = 0;
  let rescanned = 0;
  const details = [];

  async function processList(list, purpose) {
    if (!typeSet.has(purpose)) return;
    for (const entry of list || []) {
      examined += 1;
      if (!needsVendorRepair(entry)) continue;
      if (!entry.receiptId) {
        skipped += 1;
        details.push({
          id: entry.id,
          purpose,
          ok: false,
          reason: "no_receipt",
          from: entryVendor(entry),
        });
        continue;
      }
      const receipt = receiptsById.get(entry.receiptId);
      if (!receipt) {
        skipped += 1;
        details.push({
          id: entry.id,
          purpose,
          ok: false,
          reason: "receipt_missing",
          from: entryVendor(entry),
        });
        continue;
      }

      eligible += 1;
      if (limit > 0 && updated >= limit) break;

      const hadLittleText = !String(
        (receipt.ocrResult && (receipt.ocrResult.rawText || receipt.ocrResult.rawTextPreview)) ||
          ""
      ).trim();
      const change = await proposeVendorRepair(entry, receipt, purpose, vendors, openai, {
        reOcr,
      });
      if (reOcr || hadLittleText) rescanned += 1;

      if (!change.ok) {
        skipped += 1;
        details.push({
          id: entry.id,
          purpose,
          ok: false,
          reason: change.reason || "unresolved",
          from: entryVendor(entry),
          to: change.proposed || "",
        });
        continue;
      }

      if (!dryRun) {
        applyVendorRepair(entry, receipt, change, records);
      }
      updated += 1;
      details.push(change);
    }
  }

  await processList(records.expenses, "expense");
  await processList(records.income, "income");

  return {
    examined,
    eligible,
    updated,
    skipped,
    rescanned,
    dryRun: Boolean(dryRun),
    details,
  };
}

module.exports = {
  needsVendorRepair,
  isConfidentVendor,
  entryVendor,
  proposeVendorRepair,
  applyVendorRepair,
  repairVendorsFromScans,
  ocrSeedFromReceipt,
};
