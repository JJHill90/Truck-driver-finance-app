/**
 * Optional ABR JSON lookup. ABR_GUID stays on the server.
 * Gst null means the ABN is not GST-registered.
 */
const { isValidAbn, normaliseAbn } = require("./vendor-enrichment");

const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

function parseJsonp(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return JSON.parse(raw.slice(start, end + 1));
}

async function lookupAbn(abn, options = {}) {
  const guid = process.env.ABR_GUID;
  if (!guid) return null;
  const digits = normaliseAbn(abn);
  if (!isValidAbn(digits)) return null;
  const hit = cache.get(digits);
  if (hit && hit.expires > Date.now()) return hit.value;
  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${digits}&guid=${encodeURIComponent(guid)}`;
  const fetcher = options.fetch || global.fetch;
  const signal = options.signal;
  const res = await fetcher(url, { signal });
  if (!res.ok) return null;
  const body = parseJsonp(await res.text());
  if (!body || body.Message) return null;
  const gst = body.Gst;
  const value = {
    abn: digits,
    name: String(body.EntityName || body.BusinessName || "").trim(),
    gstRegistered: gst != null && String(gst).trim() !== "",
  };
  cache.set(digits, { value, expires: Date.now() + CACHE_MS });
  return value;
}

function applyAbrToOcr(ocr, details) {
  if (!ocr || !details) return ocr;
  if (details.name && (!ocr.vendor || /tax invoice|receipt/i.test(ocr.vendor))) {
    ocr.vendor = details.name;
    ocr.entity = ocr.entity || details.name;
  }
  ocr.abr = { name: details.name, gstRegistered: details.gstRegistered };
  if (!details.gstRegistered) {
    ocr.gst = 0;
    ocr.gstAmount = 0;
    ocr.gstFree = true;
  }
  return ocr;
}

module.exports = { lookupAbn, applyAbrToOcr, parseJsonp };
