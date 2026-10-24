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

function siblingThumbRelative(imagePath) {
  const rel = String(imagePath || "").replace(/\\/g, "/");
  if (!rel || !/\.pdf$/i.test(rel)) return null;
  return rel.replace(/\.pdf$/i, ".thumb.png");
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
  const pdfRel = String(thumbRel || "").replace(/\.thumb\.png$/i, ".pdf");
  const info =
    storage && typeof storage.getReceiptFileInfo === "function"
      ? storage.getReceiptFileInfo(pdfRel)
      : null;
  if (!info || !info.filePath) return;
  const parsed = path.parse(info.filePath);
  writeFileAtomic(path.join(parsed.dir, `${parsed.name}.thumb.png`), pngBuffer);
}

async function generateThumbDataUrl(receipt, storage) {
  const existing = readExistingThumb(siblingThumbRelative(receipt.imagePath), storage);
  if (existing) return existing;

  const pdfDataUrl =
    storage && typeof storage.readReceiptImage === "function"
      ? storage.readReceiptImage(receipt.imagePath)
      : null;
  if (!pdfDataUrl) return null;

  const pages = await renderPdfPagesToPng(pdfDataUrl, {
    maxPages: 1,
    zoom: THUMB_ZOOM,
    timeoutMs: THUMB_TIMEOUT_MS,
  });
  if (!pages.length) return null;
  const png = Buffer.from(pages[0], "base64");
  try {
    writeThumb(siblingThumbRelative(receipt.imagePath), png, storage);
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

function deleteThumb(imagePath, storage) {
  const rel = siblingThumbRelative(imagePath);
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
