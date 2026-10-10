/**
 * Slim OCR payloads for browser / Android WebView responses.
 * Full text stays on the stored receipt for server-side re-reads.
 */

const RAW_TEXT_CLIENT_MAX = 1200;
const LINE_ITEM_CLIENT_MAX = 40;
const CANDIDATE_CLIENT_MAX = 24;

function slimOcrResultForClient(ocr) {
  if (!ocr || typeof ocr !== "object") return ocr || null;
  const raw = String(ocr.rawText || "");
  const preview = String(ocr.rawTextPreview || raw).slice(0, RAW_TEXT_CLIENT_MAX);
  const out = {
    ...ocr,
    rawText: raw ? raw.slice(0, RAW_TEXT_CLIENT_MAX) : preview,
    rawTextPreview: preview,
  };
  if (Array.isArray(out.lineItems) && out.lineItems.length > LINE_ITEM_CLIENT_MAX) {
    out.lineItems = out.lineItems.slice(0, LINE_ITEM_CLIENT_MAX);
  }
  if (Array.isArray(out.candidateAmounts) && out.candidateAmounts.length > CANDIDATE_CLIENT_MAX) {
    out.candidateAmounts = out.candidateAmounts.slice(0, CANDIDATE_CLIENT_MAX);
  }
  return out;
}

function presentScanJson(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  if (out.ocrResult) out.ocrResult = slimOcrResultForClient(out.ocrResult);
  return out;
}

module.exports = {
  RAW_TEXT_CLIENT_MAX,
  slimOcrResultForClient,
  presentScanJson,
};
