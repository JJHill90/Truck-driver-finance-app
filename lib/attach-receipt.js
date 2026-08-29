/**
 * Attach a receipt image/PDF to an existing unreconciled expense or income row.
 * Handles photo-less manual stubs (receiptId but no imagePath) and rows with no
 * receipt at all. Leaves storage.js verbatim.
 */
const storage = require("./storage");
const { findEntry, assertEditable } = require("./ledger-lifecycle");
const { buildDocumentFilename } = require("./document-label");

function receiptById(records, id) {
  if (!id || !records) return null;
  return (records.receipts || []).find((r) => r && r.id === id) || null;
}

function hasRealImage(receipt) {
  return Boolean(receipt && receipt.imagePath);
}

function labelAmount(entry, type) {
  if (!entry) return null;
  if (type === "income") {
    if (entry.netPay != null && Number(entry.netPay) > 0) return entry.netPay;
    if (entry.grossTotal != null && Number(entry.grossTotal) > 0) return entry.grossTotal;
  }
  return entry.amount;
}

/**
 * @param {object} records
 * @param {"expense"|"income"} type
 * @param {string} id
 * @param {{ dataUrl: string, mimeType?: string, filename?: string }} file
 * @returns {{ ok: true, entry: object, receipt: object } | { ok: false, code: string, error: string, status: number }}
 */
function attachReceiptToEntry(records, type, id, file = {}) {
  const kind = type === "income" ? "income" : "expense";
  const entry = findEntry(records, kind, id);
  const gate = assertEditable(entry);
  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code,
      error: gate.error,
      status: gate.code === "not_found" ? 404 : 409,
    };
  }

  const dataUrl = file.dataUrl || file.imageBase64 || null;
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return {
      ok: false,
      code: "missing_image",
      error: "Choose a receipt photo or PDF to attach.",
      status: 400,
    };
  }

  const existing = receiptById(records, entry.receiptId);
  if (hasRealImage(existing)) {
    return {
      ok: false,
      code: "already_has_receipt",
      error: "This entry already has a receipt photo. View it with Photo, or ask the primary mod if you need to replace it.",
      status: 409,
    };
  }

  // Drop photo-less stub so we do not leave an orphan manual-entry receipt.
  if (existing && !hasRealImage(existing)) {
    storage.deleteReceipt(records, existing.id);
  }

  const mimeType = file.mimeType || (String(dataUrl).match(/^data:([^;]+);/) || [])[1] || "image/jpeg";
  const labeledName = buildDocumentFilename({
    date: entry.date,
    amount: labelAmount(entry, kind),
    mimeType,
    originalFilename: file.filename || "receipt.jpg",
  });

  const receiptPayload = {
    source: "attach",
    purpose: kind === "income" ? "income" : "expense",
    filename: labeledName,
    mimeType,
    dataUrl,
  };
  if (kind === "income") receiptPayload.linkedIncomeId = entry.id;
  else receiptPayload.linkedExpenseId = entry.id;

  const receipt = storage.addReceipt(records, receiptPayload);
  if (!receipt.imagePath) {
    return {
      ok: false,
      code: "save_failed",
      error: "Could not save the receipt file. Try another image or PDF.",
      status: 400,
    };
  }

  entry.receiptId = receipt.id;
  entry.updatedAt = new Date().toISOString();
  if (kind === "expense") {
    entry.noReceipt = false;
    if (receipt.manual && typeof receipt.manual === "object") {
      receipt.manual.noReceipt = false;
    }
  }

  return { ok: true, entry, receipt };
}

function entryNeedsReceiptAttach(entry, records) {
  if (!entry || entry.reconciled || entry.deletedAt) return false;
  const receipt = receiptById(records, entry.receiptId);
  return !hasRealImage(receipt);
}

module.exports = {
  attachReceiptToEntry,
  entryNeedsReceiptAttach,
  hasRealImage,
  receiptById,
};
