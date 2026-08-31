/**
 * Helpers for /receipts/scan uploads.
 * JSON base64 bodies work, but large PDFs freeze Firefox's main thread while
 * the giant string is parsed/sent — multipart + Blob streams much better.
 */

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
    imageBase64 = fileToDataUrl(file);
    mimeType = mimeType || file.mimetype || "application/octet-stream";
    filename = filename || file.originalname || "upload.bin";
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
};
