/**
 * First-party helpers to keep income uploads labelled with company + pay-period
 * terminology and free of "cheque" wording (which can be picked up from a
 * document's payment-method text). The provided OCR modules are left untouched;
 * server.js applies these to the income OCR result and to saved income entries.
 */

const { searchTransportEmployers } = require("./transport-employers");

// Text fields on an income OCR result / entry that a user actually sees.
const TEXT_FIELDS = ["entity", "payer", "vendor", "description", "summaryNotes", "payPeriod", "reference", "notes"];

/** Lines OCR often grabs as the "company" that are not employer names. */
const CLUTTER_NAME_RE =
  /^(payslip|pay\s*slip|remittance|payment\s*advice|payment\s*summary|tax\s*invoice|invoice|receipt|facsimil(?:ie|e)|telephone|phone|tel\b|email|fax|abn\b|gst\b|total\b|gross\s*pay|net\s*pay|cheque\b|chq\b|payment\s*date|pay\s*period|pay\s*date|date\s*paid|description|hours?\b|amount\b|ytd\b|type\b|wages?\b|super(?:annuation)?|payg|withholding|page\s*\d|continued|docket|merchant|customer)\b/i;

const ADDRESS_LIKE_RE =
  /\b(rd|road|st|street|ave|avenue|hwy|highway|dr|drive|cres|crescent|parade|pde|blvd|boulevard|nsw|qld|vic|sa|wa|tas|nt|act)\b/i;

const PERSON_NAME_RE = /^[A-Z][A-Za-z'’-]+,\s+[A-Z]/; // "HILL, David James"

/** Remove only the "cheque"/"chq" wording (preserves surrounding layout). */
function stripChequeTokens(value) {
  if (value == null) return value;
  const s = String(value);
  if (!/cheque|chq/i.test(s)) return s;
  return s
    .replace(/\b(?:payment|paid|pay)\s+by\s+cheques?\b/gi, "")
    .replace(/\b(?:cheques?|chqs?)\s*(?:no\.?|number|#)?[:#]?\s*\d[\d-]*\b/gi, "")
    .replace(/\b(?:payment\s*method|method|tender|pay(?:ment)?\s*type)\s*[:-]?\s*cheques?\b/gi, "")
    .replace(/\bchqs?\b/gi, "")
    .replace(/\bcheques?\b/gi, "");
}

/** Remove "cheque"/"chq" wording and tidy separators/brackets (short fields). */
function stripCheque(value) {
  if (value == null) return value;
  const stripped = stripChequeTokens(value);
  if (stripped === value) return value;
  return String(stripped)
    .replace(/\(\s*\)|\[\s*\]/g, "") // empty brackets left behind
    .replace(/\s{2,}/g, " ")
    .replace(/\s*([·|,;:])\s*(?=[·|,;:]|$)/g, "")
    .replace(/^[\s·|,;:.()-]+|[\s·|,;:.()-]+$/g, "")
    .trim();
}

function titleCaseWords(s) {
  return String(s || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^(pty|ltd|t\/a|atf|abn)$/i.test(w)) return w.toUpperCase();
      if (w.length <= 2 && /^[A-Z0-9]+$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function looksLikeClutterName(name) {
  const s = String(name || "").trim();
  if (!s || s.length < 2) return true;
  if (CLUTTER_NAME_RE.test(s)) return true;
  if (ADDRESS_LIKE_RE.test(s) && !/\b(transport|logistics|express|freight|haulage|carriers?)\b/i.test(s)) {
    return true;
  }
  if (PERSON_NAME_RE.test(s)) return true;
  if (/^[\d\s./#:$-]+$/.test(s)) return true;
  if (/^(no\.?|number|#)\s*\d+/i.test(s)) return true;
  if (/@/.test(s) || /^www\./i.test(s) || /^https?:/i.test(s)) return true;
  if (/^\+?\d[\d\s()-]{6,}$/.test(s)) return true; // phone numbers
  return false;
}

/**
 * Turn an email domain into a display name (bettstransport → Betts Transport).
 */
function companyFromEmailDomain(text) {
  const src = String(text || "");
  const m = src.match(
    /@([a-z0-9-]+)\.(?:com\.au|net\.au|org\.au|co\.nz|com|net|org)\b/i
  );
  if (!m) return null;
  let domain = m[1].toLowerCase();
  if (/^(gmail|yahoo|hotmail|outlook|icloud|mail|email|admin|info|office)$/i.test(domain)) {
    return null;
  }
  domain = domain
    .replace(
      /(transport|logistics|express|freight|haulage|carriers?|group|trucking)$/i,
      " $1"
    )
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (domain.length < 3) return null;
  return titleCaseWords(domain);
}

function isoToAu(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizePeriodText(text) {
  return String(text || "")
    .replace(/\s*[–—−-]\s*/g, " to ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer a real employer/trading name over OCR junk (Facsimile, Payslip, …).
 */
function resolveIncomeCompanyName(obj = {}) {
  const candidates = [obj.entity, obj.payer, obj.vendor, obj.employer]
    .map((v) => stripCheque(v))
    .filter(Boolean);

  for (const c of candidates) {
    if (!looksLikeClutterName(c)) return String(c).trim();
  }

  const blob = [obj.rawText, obj.rawTextPreview, obj.summaryNotes, obj.notes]
    .filter(Boolean)
    .join("\n");

  const fromEmail = companyFromEmailDomain(blob);
  if (fromEmail) {
    const hits = searchTransportEmployers(fromEmail, { limit: 3 });
    if (hits.length && normalizeLoose(hits[0].name).includes(normalizeLoose(fromEmail).split(" ")[0])) {
      return hits[0].name;
    }
    return fromEmail;
  }

  // Last resort: employer directory hit from any leftover candidate token.
  for (const c of candidates) {
    const hits = searchTransportEmployers(c, { limit: 1 });
    if (hits.length) return hits[0].name;
  }

  return null;
}

function normalizeLoose(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * "pay period 03/06/2026 to 09/06/2026" (or ending date fallback).
 */
function formatPayPeriodPhrase(obj = {}) {
  const pp = obj.payPeriodInfo || {};
  if (pp.from && pp.to) {
    const fromAu = isoToAu(pp.from);
    const toAu = isoToAu(pp.to);
    if (fromAu && toAu) return `pay period ${fromAu} to ${toAu}`;
  }
  if (pp.text) {
    const normalized = normalizePeriodText(pp.text);
    if (normalized) return `pay period ${normalized}`;
  }
  const loose = stripCheque(obj.payPeriod || "");
  if (loose) return `pay period ${normalizePeriodText(loose)}`;
  const ending = isoToAu(obj.date) || stripCheque(obj.date || "");
  if (ending) return `pay period ending ${ending}`;
  return null;
}

/**
 * Canonical income description:
 *   "Betts Transport, pay period 03/06/2026 to 09/06/2026"
 * Avoids clutter like bare "Payslip" / "Facsimile".
 */
function buildIncomeDescription(obj) {
  const o = obj || {};
  const company = resolveIncomeCompanyName(o);
  const period = formatPayPeriodPhrase(o);
  if (company && period) return `${company}, ${period}`;
  if (company) return company;
  if (period) return period.charAt(0).toUpperCase() + period.slice(1);
  // Last resort — still better than OCR junk lines.
  return o.documentKind === "remittance" ? "Remittance" : "Payslip";
}

/** Strip cheque wording from every user-facing text field of an income object. */
function sanitizeIncomeFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  for (const key of TEXT_FIELDS) {
    if (typeof obj[key] === "string") obj[key] = stripCheque(obj[key]);
  }

  const company = resolveIncomeCompanyName(obj);
  if (company) {
    if (!obj.entity || looksLikeClutterName(obj.entity)) obj.entity = company;
    if (!obj.payer || looksLikeClutterName(obj.payer)) obj.payer = company;
    if (!obj.vendor || looksLikeClutterName(obj.vendor)) obj.vendor = company;
  }

  // Replace OCR/default clutter descriptions with company + pay period.
  const desc = String(obj.description || "").trim();
  if (!desc || looksLikeClutterName(desc) || /^(payslip|remittance)\b/i.test(desc)) {
    obj.description = buildIncomeDescription(obj);
  }

  // Keep summary notes short — mirror the clean description when notes are
  // the old Entity/Gross/Taxable clutter string from OCR.
  const notes = String(obj.summaryNotes || "");
  if (
    !notes.trim() ||
    /^entity\s*:/i.test(notes) ||
    /gross\s*:/i.test(notes) ||
    /taxable\s*:/i.test(notes)
  ) {
    obj.summaryNotes = obj.description || buildIncomeDescription(obj);
  }

  return obj;
}

module.exports = {
  stripCheque,
  stripChequeTokens,
  sanitizeIncomeFields,
  buildIncomeDescription,
  resolveIncomeCompanyName,
  formatPayPeriodPhrase,
  looksLikeClutterName,
  companyFromEmailDomain,
};
