/**
 * Australian date parsing and document-date resolution for expense/income scans.
 * Prefer labeled invoice/payment dates over the first date on the page (often a
 * YTD/period start), and never use V8's US MM/DD Date() for d/m/y strings.
 */
const { getFinancialYearForDate } = require("./ato-standards");

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;
const DMY_GLOBAL_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g;
const YMD_SLASH_RE = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/;

/** Labels that mark the real invoice / receipt / payment day. */
const STRONG_LABEL_RE =
  /\b(?:invoice\s*date|tax\s*invoice(?:\s*date)?|receipt\s*date|transaction\s*date|payment\s*date|date\s*paid|pay\s*date|paid\s*on|date\s*of\s*payment|date\s*of\s*issue|issued?\s*on|sale\s*date)\b/i;

/** Generic "Date:" near the value — still useful but below a strong label. */
const GENERIC_DATE_LABEL_RE = /\bdate\b/i;

/** Context that usually precedes a period/YTD/print date — not the document day. */
const WEAK_CONTEXT_RE =
  /\b(?:ytd|year[\s-]*to[\s-]*date|period\s*from|from\s*$|statement\s*period|printed|print(?:ed)?\s*date|due\s*date|valid\s*from|opening|closing|as\s*at|as\s*of)\b/i;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isValidCalendarYmd(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (year < 1990 || year > 2100) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function isoFromParts(year, month, day) {
  if (!isValidCalendarYmd(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Coerce common AU / ISO date strings to YYYY-MM-DD.
 * Ambiguous d/m/y (both ≤ 12) is always treated as day/month (Australian).
 */
function toIsoAusDate(input) {
  if (input == null || input === "") return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return isoFromParts(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  const s = String(input).trim();
  let m = s.match(ISO_RE);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(YMD_SLASH_RE);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(DMY_RE);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const day = Number(m[1]);
    const month = Number(m[2]);
    return isoFromParts(year, month, day);
  }

  // Long AU forms: "8 May 2026", "08 May 2026"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const months = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    const month = months[m[2].toLowerCase()];
    if (month) return isoFromParts(Number(m[3]), month, Number(m[1]));
  }

  return null;
}

function financialYearForAusDate(dateInput) {
  const iso = toIsoAusDate(dateInput);
  if (!iso) return null;
  return getFinancialYearForDate(iso);
}

function contextBefore(text, index, span = 48) {
  const start = Math.max(0, index - span);
  return String(text || "")
    .slice(start, index)
    .replace(/\s+/g, " ")
    .trim();
}

function rankDateContext(ctx, purpose) {
  const c = String(ctx || "");
  if (STRONG_LABEL_RE.test(c)) {
    if (/payment|paid|pay\s*date/i.test(c)) return purpose === "income" ? 96 : 90;
    return 100;
  }
  if (WEAK_CONTEXT_RE.test(c)) return 12;
  if (GENERIC_DATE_LABEL_RE.test(c)) return 75;
  return 40;
}

/**
 * Find the best document date in OCR text (AU day/month).
 * @returns {{ date: string, rank: number, label: string } | null}
 */
function extractBestDocumentDate(text, purpose = "expense") {
  const src = String(text || "");
  if (!src.trim()) return null;

  let best = null;
  DMY_GLOBAL_RE.lastIndex = 0;
  let match;
  while ((match = DMY_GLOBAL_RE.exec(src)) != null) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const iso = isoFromParts(year, month, day);
    if (!iso) continue;

    const ctx = contextBefore(src, match.index);
    const rank = rankDateContext(ctx, purpose);
    const candidate = { date: iso, rank, label: ctx.slice(-40) };

    if (
      !best ||
      candidate.rank > best.rank ||
      (candidate.rank === best.rank && candidate.date > best.date)
    ) {
      best = candidate;
    }
  }

  // Also catch ISO dates with labels (less common on AU dockets).
  const isoGlobal = /(\d{4})-(\d{2})-(\d{2})/g;
  let im;
  while ((im = isoGlobal.exec(src)) != null) {
    const iso = isoFromParts(Number(im[1]), Number(im[2]), Number(im[3]));
    if (!iso) continue;
    const ctx = contextBefore(src, im.index);
    const rank = rankDateContext(ctx, purpose);
    const candidate = { date: iso, rank, label: ctx.slice(-40) };
    if (
      !best ||
      candidate.rank > best.rank ||
      (candidate.rank === best.rank && candidate.date > best.date)
    ) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Pick the invoice/payment date that should drive FY placement.
 * Prefer labeled text / payment date over a weak first-match OCR date.
 */
function resolveDocumentDate({
  ocrDate = null,
  rawText = "",
  purpose = "expense",
  payPeriod = null,
} = {}) {
  const purposeKey = purpose === "income" ? "income" : "expense";
  const fromText = extractBestDocumentDate(rawText, purposeKey);
  const ocrIso = toIsoAusDate(ocrDate);
  const paymentIso = toIsoAusDate(payPeriod && payPeriod.paymentDate);
  const periodEndIso = toIsoAusDate(payPeriod && payPeriod.to);

  const candidates = [];
  if (fromText) {
    candidates.push({ date: fromText.date, rank: fromText.rank, source: "text" });
  }
  if (paymentIso) {
    candidates.push({
      date: paymentIso,
      rank: purposeKey === "income" ? 94 : 88,
      source: "payment",
    });
  }
  if (periodEndIso) {
    candidates.push({
      date: periodEndIso,
      rank: purposeKey === "income" ? 70 : 50,
      source: "periodEnd",
    });
  }
  if (ocrIso) {
    // Downgrade OCR date when raw text shows it was only a weak period/YTD hit.
    let rank = 55;
    if (fromText && fromText.date === ocrIso) rank = Math.min(rank, fromText.rank);
    else if (fromText && fromText.rank >= 75 && fromText.date !== ocrIso) rank = 35;
    candidates.push({ date: ocrIso, rank, source: "ocr" });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  return candidates[0].date;
}

module.exports = {
  toIsoAusDate,
  financialYearForAusDate,
  extractBestDocumentDate,
  resolveDocumentDate,
  isValidCalendarYmd,
};
