/**
 * Client helpers for large /receipts/scan payloads (Firefox-safe).
 * Kept as a CommonJS module so Node unit tests can cover the string peeking
 * without a browser; enhancements.js inlines the browser FormData path.
 */

/**
 * Read purpose / forceDuplicate from the cheap ends of a JSON scan body
 * without JSON.parse of the multi-MB imageBase64 string.
 */
function peekScanJsonMeta(bodyStr) {
  const s = String(bodyStr || "");
  const head = s.slice(0, 400);
  const tail = s.slice(-800);
  const purpose =
    /"purpose"\s*:\s*"income"/.test(tail) || /"purpose"\s*:\s*"income"/.test(head)
      ? "income"
      : "expense";
  const forceDuplicate =
    /"forceDuplicate"\s*:\s*true/.test(tail) || /"forceDuplicate"\s*:\s*true/.test(head);
  return { purpose, forceDuplicate };
}

/**
 * Extract data URL + mime + filename from app.js's JSON.stringify order
 * without a full JSON.parse (avoids freezing Firefox on remittance PDFs).
 */
function extractScanJsonFields(bodyStr) {
  const s = String(bodyStr || "");
  const key = '"imageBase64":"';
  const start = s.indexOf(key);
  if (start < 0) return null;
  const dataStart = start + key.length;
  // app.js order: imageBase64, mimeType, filename, purpose [, forceDuplicate]
  let dataEnd = s.indexOf('","mimeType":"', dataStart);
  if (dataEnd < 0) dataEnd = s.indexOf('","mimeType": "', dataStart);
  if (dataEnd < 0) {
    // Fallback: closing quote before next field
    dataEnd = s.indexOf('","', dataStart);
  }
  if (dataEnd < 0) return null;
  // JSON.stringify escapes \ and " — data URLs rarely need it, but undo basics.
  const dataUrl = s
    .slice(dataStart, dataEnd)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

  const rest = s.slice(dataEnd);
  const mimeType = (rest.match(/"mimeType"\s*:\s*"([^"]*)"/) || [])[1] || "";
  const filename = (rest.match(/"filename"\s*:\s*"([^"]*)"/) || [])[1] || "upload.bin";
  const meta = peekScanJsonMeta(s);
  return {
    dataUrl,
    mimeType,
    filename,
    purpose: meta.purpose,
    forceDuplicate: meta.forceDuplicate,
  };
}

/** True when the JSON body is large enough that Firefox main-thread parse/send hurts. */
function shouldUseMultipartScan(bodyStr) {
  return typeof bodyStr === "string" && bodyStr.length >= 400_000;
}

module.exports = {
  peekScanJsonMeta,
  extractScanJsonFields,
  shouldUseMultipartScan,
};
