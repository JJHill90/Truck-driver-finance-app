/**
 * Serve gallery / viewer images from whichever product store holds the
 * receipt, and from the persistent DATA_DIR when lib/storage.js's repo-relative
 * data/ folder has diverged (Render disk vs ephemeral checkout).
 *
 * Photos are not stored in the JSON ledger — only imagePath pointers.
 * Driver Hub and Go Taxation Suite use separate disks, so a card can exist
 * on Suite after a metadata seed without the bytes on gotax-data.
 */
const fs = require("fs");
const path = require("path");
const { getDataDir } = require("./data-dir");

const MIME_BY_EXT = {
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  heic: "image/heic",
  heif: "image/heic",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

function safeRelative(imagePath) {
  const rel = String(imagePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || !rel.startsWith("receipts/")) return "";
  return rel;
}

function mimeForExt(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] || "image/jpeg";
}

function dataDirFileInfo(imagePath) {
  const rel = safeRelative(imagePath);
  if (!rel) return null;
  const filePath = path.join(getDataDir(), rel);
  if (!fs.existsSync(filePath)) return null;
  return {
    filePath,
    mime: mimeForExt(filePath),
    filename: path.basename(filePath),
  };
}

function getReceiptFileInfoSafe(imagePath, storage) {
  if (!imagePath) return null;
  if (storage && typeof storage.getReceiptFileInfo === "function") {
    try {
      const info = storage.getReceiptFileInfo(imagePath);
      if (info && info.filePath) return info;
    } catch {
      /* missing / unreadable */
    }
  }
  return dataDirFileInfo(imagePath);
}

function readReceiptDataUrl(imagePath, storage) {
  if (!imagePath) return null;
  if (storage && typeof storage.readReceiptImage === "function") {
    try {
      const dataUrl = storage.readReceiptImage(imagePath);
      if (dataUrl && /^data:/i.test(dataUrl)) return dataUrl;
    } catch {
      /* missing / unreadable */
    }
  }
  const info = dataDirFileInfo(imagePath);
  if (!info) return null;
  const base64 = fs.readFileSync(info.filePath).toString("base64");
  return `data:${info.mime};base64,${base64}`;
}

function fileAvailable(imagePath, storage) {
  return Boolean(getReceiptFileInfoSafe(imagePath, storage));
}

function findReceiptInStores(id, stores) {
  const want = String(id || "");
  if (!want) return { receipt: null, product: null, records: null };
  for (const store of stores || []) {
    const records = store && store.records;
    const receipt = ((records && records.receipts) || []).find((r) => r && r.id === want);
    if (receipt) {
      return { receipt, product: store.product || null, records };
    }
  }
  return { receipt: null, product: null, records: null };
}

async function serveReceiptImage({ receipt, storage, pdfThumbnail }) {
  if (!receipt) {
    return {
      status: 404,
      body: { error: "Receipt image not found.", missingFile: true },
    };
  }

  const available = fileAvailable(receipt.imagePath, storage);
  const isPdf = Boolean(pdfThumbnail && pdfThumbnail.isPdfReceipt && pdfThumbnail.isPdfReceipt(receipt));

  if (isPdf) {
    if (!available) {
      return {
        status: 404,
        body: {
          error: "Receipt file is not on this server. Re-upload the document on Go Taxation Suite.",
          missingFile: true,
          isPdf: true,
        },
      };
    }
    try {
      const dataUrl = await pdfThumbnail.dataUrlForReceipt(receipt, storage);
      if (dataUrl) {
        return {
          status: 200,
          body: { dataUrl, kind: "pdf-thumb", fileAvailable: true, isPdf: true },
        };
      }
    } catch (err) {
      console.warn("PDF thumbnail failed:", err && err.message);
    }
    // File is on disk — do not 415. The client shows a PDF tile and opens /file.
    return {
      status: 200,
      body: { dataUrl: null, kind: "pdf-file", fileAvailable: true, isPdf: true },
    };
  }

  const dataUrl = readReceiptDataUrl(receipt.imagePath, storage);
  if (!dataUrl) {
    return {
      status: 404,
      body: {
        error: "Receipt image not found.",
        missingFile: true,
        hasRecord: Boolean(receipt.imagePath),
      },
    };
  }
  return { status: 200, body: { dataUrl, fileAvailable: true } };
}

module.exports = {
  safeRelative,
  getReceiptFileInfoSafe,
  readReceiptDataUrl,
  fileAvailable,
  findReceiptInStores,
  serveReceiptImage,
};
