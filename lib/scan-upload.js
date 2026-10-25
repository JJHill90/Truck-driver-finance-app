/**
 * Helpers for /receipts/scan uploads.
 * JSON base64 bodies work, but large PDFs freeze Firefox's main thread while
 * the giant string is parsed/sent — multipart + Blob streams much better.
 *
 * Android / Firefox isolate (`prepareImageForUpload`) sends a tiny empty PDF
 * stub in JSON so the real File can travel as multipart. That stub must never
 * be written to disk — otherwise Suite thumbs show a blank page instead of
 * the remittance.
 */

/** Base64 of `%PDF-1.1\ntrailer<<>>\n%%EOF\n` from public/enhancements.js. */
const PDF_ISOLATE_STUB_B64 = "JVBERi0xLjEKdHJhaWxlcjw8Pj4KJSVFT0YK";

function isPdfIsolateStub(dataUrlOrBase64) {
  const raw = String(dataUrlOrBase64 || "");
  if (!raw) return false;
  if (raw.includes(PDF_ISOLATE_STUB_B64)) return true;
  const b64 = raw.includes(",") ? raw.split(",").pop() : raw;
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length || buf.length > 96) return false;
    const text = buf.toString("latin1");
    return text.startsWith("%PDF") && /trailer\s*<<\s*>>/.test(text);
  } catch {
    return false;
  }
}

/**
 * Turn a multer file (or similar) into a data-URL for the existing OCR pipeline.
 */
function fileToDataUrl(file) {
  if (!file || !file.buffer) return "";
  const mime = file.mimetype || "application/octet-stream";
  return `data:${mime};base64,${file.buffer.toString("base64")}`;
}

/**
 * Normalise scan fields from either JSON (`imageBase64`) or multipart (`file`).
 * Mutates nothing; returns a plain object suitable for the OCR handlers.
 */
function normalizeScanUpload(req) {
  const body = req.body || {};
  const file = req.file || null;
  let imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  let mimeType = body.mimeType || "";
  let filename = body.filename || "";

  if (file && file.buffer && file.buffer.length) {
    const fromFile = fileToDataUrl(file);
    if (!isPdfIsolateStub(fromFile)) {
      imageBase64 = fromFile;
      mimeType = mimeType || file.mimetype || "application/octet-stream";
      filename = filename || file.originalname || "upload.bin";
    }
  }

  const forceRaw = body.forceDuplicate;
  const forceDuplicate =
    forceRaw === true ||
    forceRaw === "true" ||
    forceRaw === "1" ||
    forceRaw === 1;

  return {
    imageBase64,
    mimeType: mimeType || "application/octet-stream",
    filename: filename || "upload.bin",
    purpose: body.purpose === "income" ? "income" : "expense",
    forceDuplicate,
  };
}

module.exports = {
  fileToDataUrl,
  normalizeScanUpload,
  isPdfIsolateStub,
  PDF_ISOLATE_STUB_B64,
};
