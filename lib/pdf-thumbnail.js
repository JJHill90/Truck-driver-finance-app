/**
 * First-page PNG thumbs for scanned PDF receipts / remittances.
 * Rasterises with the existing MuPDF helper so the gallery can show the
 * document instead of a blank "PDF" tile. Thumbs sit beside the original
 * file as receipts/<id>.thumb.png.
 */
const path = require("path");
const { renderPdfPagesToPng } = require("./pdf-ocr");
const { writeFileAtomic } = require("./atomic-write");

const THUMB_ZOOM = 1;
const THUMB_TIMEOUT_MS = 12000;

const inflight = new Map();

function isPdfReceipt(receipt) {
  if (!receipt) return false;
  return (
    /pdf/i.test(String(receipt.mimeType || "")) ||
    /\.pdf$/i.test(String(receipt.filename || receipt.imagePath || ""))
  );
}

function siblingThumbRelative(imagePath, receipt) {
  const rel = String(imagePath || "").replace(/\\/g, "/");
  if (!rel) return null;
  if (/\.pdf$/i.test(rel)) return rel.replace(/\.pdf$/i, ".thumb.png");
  // Android PDF isolate used to persist a stub as .jpg while mimeType stayed PDF.
  if (receipt && isPdfReceipt(receipt)) return rel.replace(/\.[^.]+$/i, ".thumb.png");
  return null;
}

function dataUrlFromPng(buf) {
  return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
}

function readExistingThumb(thumbRel, storage) {
  if (!thumbRel || !storage || typeof storage.readReceiptImage !== "function") return null;
  try {
    const dataUrl = storage.readReceiptImage(thumbRel);
    if (dataUrl && /^data:image\//i.test(dataUrl)) return dataUrl;
  } catch {
    /* missing / unreadable */
  }
  return null;
}

function writeThumb(thumbRel, pngBuffer, storage) {
  const thumbName = String(thumbRel || "");
  const candidates = [".pdf", ".jpg", ".jpeg", ".bin", ".png"].map((ext) =>
    thumbName.replace(/\.thumb\.png$/i, ext)
  );
  let info = null;
  if (storage && typeof storage.getReceiptFileInfo === "function") {
    for (const rel of candidates) {
      info = storage.getReceiptFileInfo(rel);
      if (info && info.filePath) break;
    }
  }
  if (!info || !info.filePath) return;
  const parsed = path.parse(info.filePath);
  writeFileAtomic(path.join(parsed.dir, `${parsed.name}.thumb.png`), pngBuffer);
}

function asPdfDataUrl(dataUrl, receipt) {
  const raw = String(dataUrl || "");
  if (!raw) return null;
  if (/^data:application\/pdf/i.test(raw)) return raw;
  if (isPdfReceipt(receipt) && /^data:/i.test(raw)) {
    return raw.replace(/^data:[^;]+/i, "data:application/pdf");
  }
  return raw;
}

async function generateThumbDataUrl(receipt, storage) {
  const existing = readExistingThumb(siblingThumbRelative(receipt.imagePath, receipt), storage);
  if (existing) return existing;

  let pdfDataUrl =
    storage && typeof storage.readReceiptImage === "function"
      ? storage.readReceiptImage(receipt.imagePath)
      : null;
  pdfDataUrl = asPdfDataUrl(pdfDataUrl, receipt);
  if (!pdfDataUrl) return null;

  const pages = await renderPdfPagesToPng(pdfDataUrl, {
    maxPages: 1,
    zoom: THUMB_ZOOM,
    timeoutMs: THUMB_TIMEOUT_MS,
  });
  if (!pages.length) return null;
  const png = Buffer.from(pages[0], "base64");
  try {
    writeThumb(siblingThumbRelative(receipt.imagePath, receipt), png, storage);
  } catch (err) {
    console.warn("PDF thumb write failed:", err.message);
  }
  return dataUrlFromPng(png);
}

async function dataUrlForReceipt(receipt, storage) {
  if (!isPdfReceipt(receipt) || !receipt.imagePath) return null;
  const key = receipt.id || receipt.imagePath;
  if (inflight.has(key)) return inflight.get(key);
  const work = generateThumbDataUrl(receipt, storage).finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

function deleteThumb(imagePath, storage, receipt) {
  const rel = siblingThumbRelative(imagePath, receipt);
  if (!rel) return false;
  if (storage && typeof storage.deleteReceiptFile === "function") {
    return Boolean(storage.deleteReceiptFile(rel));
  }
  return false;
}

module.exports = {
  THUMB_ZOOM,
  THUMB_TIMEOUT_MS,
  isPdfReceipt,
  siblingThumbRelative,
  dataUrlForReceipt,
  deleteThumb,
};
