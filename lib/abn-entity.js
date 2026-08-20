/**
 * Prefer the supplier/employer ABN and the entity name attached to it.
 * Runs after OCR and before vendor-enrichment so memory keys off the right ABN.
 *
 * Heuristics (tighter than "first 11 digits in the document"):
 *  - collect labeled / spaced / compact ABN candidates with line context
 *  - require ABR modulus-89 validity
 *  - prefer ABN near the business name (same/nearby lines)
 *  - prefer header area; demote customer/buyer/purchaser ABNs and footer noise
 *  - pull the entity/vendor string attached to the winning ABN
 */
const {
  normaliseAbn,
  formatAbn,
  isValidAbn,
  looksLikeJunkVendor,
  looksLikeLegalEntityName,
  extractReceiptBusinessName,
} = require("./vendor-enrichment");

const BOILERPLATE_LINE_RE =
  /^(tax\s*invoice|taxinvoice|invoice|receipt|abn\b|gst\b|total\b|subtotal|amount\s*due|change\b|eftpos|visa|mastercard|debit|credit|thank\s*you|store\s*#?\d+|terminal|merchant\s*copy|customer\s*copy|docket|page\s*\d+|continued)\b/i;

const CUSTOMER_ABN_RE =
  /\b(customer|purchaser|buyer|your|cardholder|recipient|sold\s*to|bill\s*to|ship\s*to)\b/i;

const SUPPLIER_HINT_RE =
  /\b(supplier|seller|merchant|vendor|business|trading\s*as|t\/?a|employer|company|pty|ltd|abn)\b/i;

const ENTITY_NAME_RE =
  /\b(pty\.?\s*ltd\.?|limited|ltd\.?|trust|partnership|trading\s*as|t\/a|incorporated|inc\.?|group|holdings|services|transport|haulage|logistics|cafe|roadhouse|supermarket)\b/i;

function splitLines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, idx, arr) => l || (idx > 0 && arr[idx - 1]));
}

function lineWindow(lines, index, radius = 3) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join(" ");
}

function previousEntityLine(lines, index) {
  for (let i = index; i >= Math.max(0, index - 4); i -= 1) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;
    if (i === index) {
      const before = line.split(/\bABN\b/i)[0].replace(/[:#\-–—|]+$/g, "").trim();
      if (before && !BOILERPLATE_LINE_RE.test(before) && !/^\d[\d\s./-]*$/.test(before)) {
        return cleanEntityName(before);
      }
      continue;
    }
    if (BOILERPLATE_LINE_RE.test(line)) continue;
    if (CUSTOMER_ABN_RE.test(line) && !ENTITY_NAME_RE.test(line)) continue;
    if (/^\d[\d\s./$-]*$/.test(line)) continue;
    if (/^(tel|phone|ph|fax|email|www\.|http)/i.test(line)) continue;
    if (line.length < 2 || line.length > 80) continue;
    const cleaned = cleanEntityName(line);
    if (!cleaned || CUSTOMER_ABN_RE.test(cleaned)) continue;
    return cleaned;
  }
  return "";
}

function cleanEntityName(raw) {
  let s = String(raw || "")
    .replace(/\bABN[:\s#]*[0-9][0-9\s]{8,18}/gi, "")
    .replace(/\bA\.?C\.?N\.?[:\s#]*[0-9\s]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s|:;,\-–—]+|[\s|:;,\-–—]+$/g, "")
    .trim();
  // Drop trailing address crumbs that sometimes share the header line.
  s = s.replace(/,?\s*\d{1,5}\s+[A-Za-z].*$/, (m) => (m.length > 24 ? "" : m)).trim();
  if (s.length < 2) return "";
  return s.slice(0, 80);
}

function nameNearCandidate(name, context) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (n.length < 3) return false;
  const ctx = String(context || "").toLowerCase();
  const tokens = n.split(/\s+/).filter((t) => t.length >= 3);
  if (!tokens.length) return ctx.includes(n);
  const hits = tokens.filter((t) => ctx.includes(t)).length;
  return hits >= Math.min(2, tokens.length) || ctx.includes(n);
}

/**
 * @returns {Array<{ digits: string, formatted: string, lineIndex: number, line: string, labeled: boolean, entity: string, score: number, reason: string[] }>}
 */
function collectAbnCandidates(text, { hintName } = {}) {
  const lines = splitLines(text);
  const found = [];
  const seen = new Set();

  const push = (rawDigits, lineIndex, labeled) => {
    const digits = normaliseAbn(rawDigits);
    if (digits.length !== 11 || !isValidAbn(digits)) return;
    const key = `${digits}@${lineIndex}`;
    if (seen.has(key)) return;
    seen.add(key);

    const line = String(lines[lineIndex] || "");
    const localContext = [lines[lineIndex - 1] || "", line].join(" ");
    const nearbyContext = lineWindow(lines, lineIndex, 2);
    const entity = previousEntityLine(lines, lineIndex);
    const reasons = [];
    let score = 0;

    if (labeled) {
      score += 100;
      reasons.push("labeled");
    } else {
      score += 40;
      reasons.push("pattern");
    }
    if (isValidAbn(digits)) {
      score += 50;
      reasons.push("checksum");
    }
    if (lineIndex <= 14) {
      score += 25;
      reasons.push("header");
    } else if (lineIndex >= Math.max(0, lines.length - 6)) {
      score -= 20;
      reasons.push("footer");
    }
    // Only the ABN line / immediate previous line count for customer vs supplier
    // (a wider window incorrectly penalises the merchant ABN when a customer ABN
    // appears earlier on the docket).
    if (CUSTOMER_ABN_RE.test(localContext)) {
      score -= 120;
      reasons.push("customer_context");
    }
    if (SUPPLIER_HINT_RE.test(localContext)) {
      score += 20;
      reasons.push("supplier_hint");
    }
    if (entity && !CUSTOMER_ABN_RE.test(entity)) {
      score += 35;
      reasons.push("entity_nearby");
      if (ENTITY_NAME_RE.test(entity)) {
        score += 20;
        reasons.push("entity_looks_business");
      }
    }
    if (hintName && nameNearCandidate(hintName, nearbyContext + " " + entity)) {
      score += 45;
      reasons.push("matches_hint_name");
    }
    // Demote ABNs sitting on TOTAL/payment lines (card slips).
    if (/\b(total|visa|mastercard|eftpos|amount\s*due|paid)\b/i.test(line) && !/\babn\b/i.test(line)) {
      score -= 35;
      reasons.push("payment_line");
    }

    found.push({
      digits,
      formatted: formatAbn(digits),
      lineIndex,
      line,
      labeled,
      entity,
      score,
      reason: reasons,
    });
  };

  lines.forEach((line, lineIndex) => {
    const labeledRe = /\bABN[:\s#]*([0-9][0-9\s]{9,16}[0-9])/gi;
    let m;
    while ((m = labeledRe.exec(line))) {
      push(m[1], lineIndex, true);
    }
    const spacedRe = /\b(\d{2}\s\d{3}\s\d{3}\s\d{3})\b/g;
    while ((m = spacedRe.exec(line))) {
      push(m[1], lineIndex, false);
    }
    const compactRe = /\b(\d{11})\b/g;
    while ((m = compactRe.exec(line))) {
      push(m[1], lineIndex, false);
    }
  });

  found.sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex);
  return found;
}

function pickBestAbnCandidate(text, opts = {}) {
  const candidates = collectAbnCandidates(text, opts);
  if (!candidates.length) return null;
  return { best: candidates[0], candidates };
}

/**
 * Mutates ocrResult with the preferred ABN + attached entity/vendor.
 * Preserves existing amount / totals fields.
 */
function applyAbnEntityPairing(ocrResult, purpose = "expense") {
  if (!ocrResult || typeof ocrResult !== "object") return ocrResult;
  const raw = ocrResult.rawText || ocrResult.rawTextPreview || "";
  if (!raw || !String(raw).trim()) return ocrResult;

  const hintName =
    purpose === "income"
      ? ocrResult.entity || ocrResult.payer || ocrResult.vendor || ""
      : ocrResult.vendor || ocrResult.entity || "";

  const picked = pickBestAbnCandidate(raw, { hintName });
  if (!picked) return ocrResult;

  const { best, candidates } = picked;
  const existingDigits = normaliseAbn(ocrResult.vendorAbn);
  const existingOk = existingDigits.length === 11 && isValidAbn(existingDigits);

  // Replace missing / invalid OCR ABN, or a lower-scoring first-hit ABN when
  // the paired candidate is clearly better (header + entity attachment).
  let useBest = !existingOk;
  if (existingOk && existingDigits !== best.digits) {
    const existingCand = candidates.find((c) => c.digits === existingDigits);
    const existingScore = existingCand ? existingCand.score : 0;
    useBest = best.score >= existingScore + 25;
  } else if (existingOk && existingDigits === best.digits) {
    useBest = true;
  }

  const switchedAbn =
    useBest && (!existingOk || !existingDigits || existingDigits !== best.digits);

  if (useBest) {
    ocrResult.vendorAbn = best.formatted;
  }

  const attached = best.entity;
  if (attached) {
    if (purpose === "income") {
      const current = ocrResult.entity || ocrResult.payer || ocrResult.vendor || "";
      if (
        !current ||
        looksLikeJunkVendor(current) ||
        nameNearCandidate(current, attached) ||
        (switchedAbn && !nameNearCandidate(current, attached))
      ) {
        ocrResult.entity = attached;
        ocrResult.payer = ocrResult.payer || attached;
        ocrResult.vendor = ocrResult.vendor || attached;
      }
    } else {
      const current = ocrResult.vendor || "";
      const headerBiz = extractReceiptBusinessName(raw);
      // Prefer the printed trading/site name over a Pty Ltd legal entity on the ABN line.
      const preferTrading =
        headerBiz &&
        looksLikeLegalEntityName(attached) &&
        !looksLikeLegalEntityName(headerBiz);

      if (!current || looksLikeJunkVendor(current) || looksLikeLegalEntityName(current)) {
        ocrResult.vendor = preferTrading ? headerBiz : attached;
      } else if (looksLikeLegalEntityName(attached) && !looksLikeLegalEntityName(current)) {
        // Keep receipt trading/site name; do not overwrite with ABN legal entity.
      } else if (nameNearCandidate(current, attached) && attached.length > current.length) {
        // Prefer the fuller trading name only when it is not a conflicting Pty Ltd.
        if (!(looksLikeLegalEntityName(attached) && preferTrading)) {
          ocrResult.vendor = attached;
        }
      } else if (switchedAbn && !nameNearCandidate(current, attached)) {
        // OCR first-line was a product/junk while the winning ABN sits under the real merchant.
        ocrResult.vendor = preferTrading ? headerBiz : attached;
      }
    }
  }

  ocrResult.abnEntityMatch = {
    abn: ocrResult.vendorAbn || best.formatted,
    entity: attached || null,
    score: best.score,
    reasons: best.reason,
    candidates: candidates.slice(0, 5).map((c) => ({
      abn: c.formatted,
      entity: c.entity || null,
      score: c.score,
      lineIndex: c.lineIndex,
    })),
  };

  return ocrResult;
}

module.exports = {
  collectAbnCandidates,
  pickBestAbnCandidate,
  applyAbnEntityPairing,
  previousEntityLine,
  cleanEntityName,
};
