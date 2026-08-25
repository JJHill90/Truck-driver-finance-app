/**
 * Fuel Hub employer fuel-receipt submissions.
 * Separate from the Taxation Hub expense ledger: scan → confirm → nominate
 * a saved contact → send a report after a 30s confirmation window.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIRM_MS = 30000;
const MAX_CONTACTS = 40;
const MAX_RECEIPTS = 80;
const DATA_DIR = path.join(__dirname, "..", "data");

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function trimStr(value, max = 80) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimStr(value, 160));
}

function ensureLists(store) {
  if (!store || typeof store !== "object") return store;
  if (!Array.isArray(store.employerContacts)) store.employerContacts = [];
  if (!Array.isArray(store.fuelReceipts)) store.fuelReceipts = [];
  return store;
}

function guessLitres(ocr = {}) {
  const bits = [
    ocr.rawText,
    ocr.rawTextPreview,
    ocr.description,
    ocr.notes,
    ...((ocr.lineItems || []).map((row) =>
      [row.description, row.text, row.label, row.qty, row.quantity].filter(Boolean).join(" ")
    )),
  ]
    .filter(Boolean)
    .join("\n");
  const match = bits.match(/(\d{1,4}(?:\.\d{1,2})?)\s*(?:L\b|ltrs?\b|litres?\b)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 && n < 5000 ? Math.round(n * 100) / 100 : null;
}

function saveReceiptImage(receiptId, dataUrl) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  let ext = "jpg";
  if (mime.includes("png")) ext = "png";
  else if (mime.includes("webp")) ext = "webp";
  else if (mime.includes("pdf")) ext = "pdf";
  else if (mime.includes("heic") || mime.includes("heif")) ext = "heic";
  const dir = path.join(DATA_DIR, "receipts");
  fs.mkdirSync(dir, { recursive: true });
  const relativePath = `receipts/${receiptId}.${ext}`;
  fs.writeFileSync(path.join(DATA_DIR, relativePath), Buffer.from(match[2], "base64"));
  return relativePath;
}

function receiptImageAbsPath(relativePath) {
  if (!relativePath) return null;
  const safe = String(relativePath).replace(/\\/g, "/");
  if (!safe.startsWith("receipts/") || safe.includes("..")) return null;
  return path.join(DATA_DIR, safe);
}

function normalizeContact(raw = {}, { now = new Date().toISOString() } = {}) {
  const email = trimStr(raw.email, 160).toLowerCase();
  if (!isEmail(email)) {
    const err = new Error("Enter a valid email address for this contact.");
    err.status = 400;
    throw err;
  }
  const name = trimStr(raw.name || raw.label, 80) || email.split("@")[0];
  return {
    id: trimStr(raw.id, 64) || newId(),
    name,
    email,
    company: trimStr(raw.company || raw.employer, 80),
    role: trimStr(raw.role || raw.title, 80),
    notes: trimStr(raw.notes, 200),
    createdAt: raw.createdAt || now,
    lastUsedAt: raw.lastUsedAt || null,
    updatedAt: now,
  };
}

function upsertContact(store, raw) {
  ensureLists(store);
  const contact = normalizeContact(raw);
  const list = store.employerContacts;
  const idx = list.findIndex(
    (c) => c.id === contact.id || String(c.email).toLowerCase() === contact.email
  );
  if (idx >= 0) {
    const prev = list[idx];
    contact.id = prev.id;
    contact.createdAt = prev.createdAt || contact.createdAt;
    contact.lastUsedAt = prev.lastUsedAt || contact.lastUsedAt;
    if (!contact.company) contact.company = prev.company;
    if (!contact.role) contact.role = prev.role;
    if (!contact.notes) contact.notes = prev.notes;
    list[idx] = contact;
  } else {
    list.unshift(contact);
  }
  store.employerContacts = list.slice(0, MAX_CONTACTS);
  return contact;
}

function removeContact(store, id) {
  ensureLists(store);
  const before = store.employerContacts.length;
  store.employerContacts = store.employerContacts.filter((c) => c.id !== id);
  return store.employerContacts.length !== before;
}

function touchContact(store, id, { now = new Date().toISOString() } = {}) {
  ensureLists(store);
  const row = store.employerContacts.find((c) => c.id === id);
  if (row) row.lastUsedAt = now;
  return row || null;
}

function fieldsFromOcr(ocr = {}) {
  const amount = Number(ocr.amount || ocr.grossTotal || 0) || null;
  return {
    vendor: trimStr(ocr.vendor || ocr.entity, 80),
    date: trimStr(ocr.date, 32),
    amount: amount && amount > 0 ? Math.round(amount * 100) / 100 : null,
    litres: guessLitres(ocr),
    site: trimStr(ocr.entity && ocr.entity !== ocr.vendor ? ocr.entity : ocr.vendor, 80),
    notes: trimStr(ocr.notes, 240),
  };
}

function createFromScan(store, { ocr = {}, filename, mimeType, dataUrl } = {}) {
  ensureLists(store);
  const now = new Date().toISOString();
  const id = newId();
  const fields = fieldsFromOcr(ocr);
  const imagePath = saveReceiptImage(id, dataUrl);
  const row = {
    id,
    status: "scanned",
    filename: trimStr(filename, 120) || "fuel-receipt.jpg",
    mimeType: trimStr(mimeType, 80) || "image/jpeg",
    imagePath,
    vendor: fields.vendor,
    date: fields.date,
    amount: fields.amount,
    litres: fields.litres,
    site: fields.site,
    notes: fields.notes,
    ocrPreview: trimStr(ocr.rawTextPreview || ocr.rawText, 400),
    contactId: null,
    contactEmail: null,
    contactName: null,
    contactCompany: null,
    sendAfter: null,
    sentAt: null,
    mail: null,
    createdAt: now,
    updatedAt: now,
  };
  store.fuelReceipts.unshift(row);
  store.fuelReceipts = store.fuelReceipts.slice(0, MAX_RECEIPTS);
  return row;
}

function findReceipt(store, id) {
  ensureLists(store);
  return store.fuelReceipts.find((r) => r.id === id) || null;
}

function confirmDetails(store, id, raw = {}) {
  const row = findReceipt(store, id);
  if (!row) {
    const err = new Error("Fuel receipt not found.");
    err.status = 404;
    throw err;
  }
  if (row.status === "sent") {
    const err = new Error("This receipt has already been sent.");
    err.status = 400;
    throw err;
  }
  const amount = Number(raw.amount);
  const litres = raw.litres === "" || raw.litres == null ? row.litres : Number(raw.litres);
  row.vendor = trimStr(raw.vendor, 80) || row.vendor;
  row.date = trimStr(raw.date, 32) || row.date;
  row.amount = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : row.amount;
  row.litres = Number.isFinite(litres) && litres > 0 ? Math.round(litres * 100) / 100 : row.litres;
  row.site = trimStr(raw.site, 80) || row.site;
  row.notes = trimStr(raw.notes, 240);
  row.status = "confirmed";
  row.sendAfter = null;
  row.updatedAt = new Date().toISOString();
  return row;
}

function nominate(store, id, contactRaw, { now = new Date(), confirmMs = CONFIRM_MS } = {}) {
  const row = findReceipt(store, id);
  if (!row) {
    const err = new Error("Fuel receipt not found.");
    err.status = 404;
    throw err;
  }
  if (row.status === "sent") {
    const err = new Error("This receipt has already been sent.");
    err.status = 400;
    throw err;
  }
  if (row.status !== "confirmed" && row.status !== "awaiting_send") {
    const err = new Error("Confirm the receipt details before nominating an employer.");
    err.status = 400;
    throw err;
  }
  const contact = upsertContact(store, contactRaw);
  touchContact(store, contact.id, { now: now.toISOString() });
  row.contactId = contact.id;
  row.contactEmail = contact.email;
  row.contactName = contact.name;
  row.contactCompany = contact.company;
  row.status = "awaiting_send";
  row.sendAfter = new Date(now.getTime() + confirmMs).toISOString();
  row.updatedAt = now.toISOString();
  return { receipt: row, contact };
}

function remainingMs(row, { now = new Date() } = {}) {
  if (!row || !row.sendAfter) return 0;
  return Math.max(0, new Date(row.sendAfter).getTime() - now.getTime());
}

function assertSendable(row, { now = new Date(), force = false } = {}) {
  if (!row) {
    const err = new Error("Fuel receipt not found.");
    err.status = 404;
    throw err;
  }
  if (row.status === "sent") {
    const err = new Error("This receipt has already been sent.");
    err.status = 400;
    throw err;
  }
  if (row.status === "cancelled") {
    const err = new Error("This receipt was cancelled.");
    err.status = 400;
    throw err;
  }
  if (row.status !== "awaiting_send" || !row.contactEmail) {
    const err = new Error("Nominate an employer email before sending.");
    err.status = 400;
    throw err;
  }
  const wait = remainingMs(row, { now });
  if (!force && wait > 0) {
    const err = new Error("Confirmation period still running.");
    err.status = 409;
    err.remainingMs = wait;
    throw err;
  }
  return row;
}

function markSent(store, id, mailResult, { now = new Date().toISOString() } = {}) {
  const row = findReceipt(store, id);
  if (!row) {
    const err = new Error("Fuel receipt not found.");
    err.status = 404;
    throw err;
  }
  row.status = mailResult && mailResult.sent === false && !mailResult.preview ? "failed" : "sent";
  row.sentAt = now;
  row.mail = {
    sent: Boolean(mailResult && mailResult.sent),
    channel: (mailResult && mailResult.channel) || (mailResult && mailResult.preview ? "dev" : null),
    error: (mailResult && mailResult.error) || null,
  };
  row.updatedAt = now;
  return row;
}

function cancelReceipt(store, id) {
  const row = findReceipt(store, id);
  if (!row) {
    const err = new Error("Fuel receipt not found.");
    err.status = 404;
    throw err;
  }
  if (row.status === "sent") {
    const err = new Error("This receipt has already been sent.");
    err.status = 400;
    throw err;
  }
  row.status = "cancelled";
  row.sendAfter = null;
  row.updatedAt = new Date().toISOString();
  return row;
}

function presentReceipt(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    filename: row.filename,
    mimeType: row.mimeType,
    hasImage: Boolean(row.imagePath),
    vendor: row.vendor,
    date: row.date,
    amount: row.amount,
    litres: row.litres,
    site: row.site,
    notes: row.notes,
    ocrPreview: row.ocrPreview || "",
    contactId: row.contactId,
    contactEmail: row.contactEmail,
    contactName: row.contactName,
    contactCompany: row.contactCompany,
    sendAfter: row.sendAfter,
    remainingMs: remainingMs(row),
    sentAt: row.sentAt,
    mail: row.mail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function presentContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    role: row.role,
    notes: row.notes,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function aud(n) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function buildReport({ receipt, contact, hub, username }) {
  const driver = (hub && (hub.displayName || hub.name)) || username || "Driver";
  const lines = [
    "Fuel Hub — fuel receipt report",
    "================================",
    "",
    `Driver:     ${driver}`,
    hub && hub.employer ? `Employer:   ${hub.employer}` : null,
    username ? `Username:   ${username}` : null,
    "",
    "RECEIPT",
    "-------",
    `Vendor:     ${receipt.vendor || "—"}`,
    `Site:       ${receipt.site || "—"}`,
    `Date:       ${receipt.date || "—"}`,
    `Amount:     ${aud(receipt.amount)} AUD`,
    `Litres:     ${receipt.litres != null ? `${receipt.litres} L` : "—"}`,
    receipt.notes ? `Notes:      ${receipt.notes}` : null,
    "",
    "SEND TO",
    "-------",
    `Name:       ${(contact && contact.name) || receipt.contactName || "—"}`,
    `Email:      ${(contact && contact.email) || receipt.contactEmail || "—"}`,
    (contact && contact.company) || receipt.contactCompany
      ? `Company:    ${(contact && contact.company) || receipt.contactCompany}`
      : null,
    "",
    "Submitted from Fuel Hub so the nominated contact can process this fill.",
  ].filter((line) => line !== null);
  const text = lines.join("\n");
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>Fuel receipt</title></head>
<body style="margin:0;padding:0;background:#e8eef4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eef4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #c5d0db;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0b3d6e;padding:18px 22px;">
          <div style="font:700 18px/1.3 Arial,Helvetica,sans-serif;color:#fff;">Fuel Hub</div>
          <div style="margin-top:4px;font:400 13px/1.4 Arial,Helvetica,sans-serif;color:#f0c14b;">Fuel receipt report</div>
        </td></tr>
        <tr><td style="padding:18px 22px;font:400 15px/1.5 Arial,Helvetica,sans-serif;color:#1a2332;">
          <p><strong>${escapeHtml(driver)}</strong> submitted a fuel docket for processing.</p>
          <p>Vendor: ${escapeHtml(receipt.vendor || "—")}<br/>
          Site: ${escapeHtml(receipt.site || "—")}<br/>
          Date: ${escapeHtml(receipt.date || "—")}<br/>
          Amount: ${escapeHtml(aud(receipt.amount))} AUD<br/>
          Litres: ${escapeHtml(receipt.litres != null ? `${receipt.litres} L` : "—")}</p>
          ${receipt.notes ? `<p>Notes: ${escapeHtml(receipt.notes)}</p>` : ""}
          <p style="color:#5a6b7d;font-size:13px;">The scanned image is attached when available.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const subject = `Fuel receipt — ${receipt.vendor || "docket"}${receipt.date ? ` ${receipt.date}` : ""}`;
  return { text, html, subject };
}

module.exports = {
  CONFIRM_MS,
  isEmail,
  ensureLists,
  guessLitres,
  saveReceiptImage,
  receiptImageAbsPath,
  upsertContact,
  removeContact,
  touchContact,
  fieldsFromOcr,
  createFromScan,
  findReceipt,
  confirmDetails,
  nominate,
  remainingMs,
  assertSendable,
  markSent,
  cancelReceipt,
  presentReceipt,
  presentContact,
  buildReport,
};
