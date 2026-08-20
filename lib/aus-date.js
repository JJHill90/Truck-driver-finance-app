/**
 * Australian date parsing and document-date resolution for expense/income scans.
 * Prefer labeled invoice/payment dates over the first date on the page (often a
 * YTD/period start), and never use V8's US MM/DD Date() for d/m/y strings.
 *
 * Years are clamped to a sliding window around "today" so OCR misreads like
 * 20/07/70 → 2070 do not create far-future financial years.
 */
const { getFinancialYearForDate } = require("./ato-standards");

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;
const DMY_GLOBAL_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g;
const YMD_SLASH_RE = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/;

/** How far back a receipt/payslip year may be (covers prior FY uploads). */
const DOCUMENT_YEAR_PAST = 20;
/** How far ahead a document year may be (next calendar year only). */
const DOCUMENT_YEAR_FUTURE = 1;

/** Labels that mark the real invoice / receipt / payment day. */
const STRONG_LABEL_RE =
  /\b(?:invoice\s*date|tax\s*invoice\s*date|receipt\s*date|transaction\s*date|payment\s*date|date\s*paid|pay\s*date|paid\s*on|date\s*of\s*payment|date\s*of\s*issue|issued?\s*on|sale\s*date)\b/i;

/** EFTPOS / terminal timestamps on AU thermal dockets (DD/MM/YY HH:MM). */
const EFTPOS_TIMESTAMP_RE = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+\d{1,2}:\d{2}\b/;

/**
 * Common OCR month-digit confusions on thermal paper (8↔6, 8↔0, …).
 * Only used to repair a date that is implausibly old vs today.
 */
const MONTH_DIGIT_CONFUSIONS = {
  0: [8, 9],
  3: [8],
  5: [6, 8],
  6: [8, 5, 0],
  8: [6, 0, 3],
  9: [0],
};

/** Generic "Date:" near the value — still useful but below a strong label. */
const GENERIC_DATE_LABEL_RE = /\bdate\b/i;

/** Context that usually precedes a period/YTD/print date — not the document day. */
const WEAK_CONTEXT_RE =
  /\b(?:ytd|year[\s-]*to[\s-]*date|period\s*from|from\s*$|statement\s*period|printed|print(?:ed)?\s*date|due\s*date|valid\s*from|opening|closing|as\s*at|as\s*of)\b/i;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function referenceYear(now = new Date()) {
  const y = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getFullYear() : new Date().getFullYear();
  return y;
}

/** True when the year is close enough to today for a trucking receipt/payslip. */
function isPlausibleDocumentYear(year, now = new Date()) {
  if (!Number.isFinite(year)) return false;
  const ref = referenceYear(now);
  return year >= ref - DOCUMENT_YEAR_PAST && year <= ref + DOCUMENT_YEAR_FUTURE;
}

/**
 * Expand a 2-digit year into a 4-digit year inside the plausible window.
 * Prefers 20xx; falls back to 19xx only when that lands in-window (rare).
 * Returns null when neither century fits (e.g. OCR "70" → 2070 today).
 */
function expandTwoDigitYear(yy, now = new Date()) {
  const y2 = ((Number(yy) % 100) + 100) % 100;
  if (!Number.isFinite(y2)) return null;
  const cand2000 = 2000 + y2;
  if (isPlausibleDocumentYear(cand2000, now)) return cand2000;
  const cand1900 = 1900 + y2;
  if (isPlausibleDocumentYear(cand1900, now)) return cand1900;
  return null;
}

function isValidCalendarYmd(year, month, day, now = new Date()) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (!isPlausibleDocumentYear(year, now)) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function isoFromParts(year, month, day, now = new Date()) {
  if (!isValidCalendarYmd(year, month, day, now)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Coerce common AU / ISO date strings to YYYY-MM-DD.
 * Ambiguous d/m/y (both ≤ 12) is always treated as day/month (Australian).
 */
function toIsoAusDate(input, now = new Date()) {
  if (input == null || input === "") return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return isoFromParts(input.getFullYear(), input.getMonth() + 1, input.getDate(), now);
  }
  const s = String(input).trim();
  let m = s.match(ISO_RE);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]), now);

  m = s.match(YMD_SLASH_RE);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]), now);

  m = s.match(DMY_RE);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) {
      year = expandTwoDigitYear(year, now);
      if (year == null) return null;
    }
    const day = Number(m[1]);
    const month = Number(m[2]);
    return isoFromParts(year, month, day, now);
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
    if (month) return isoFromParts(Number(m[3]), month, Number(m[1]), now);
  }

  return null;
}

function financialYearForAusDate(dateInput, now = new Date()) {
  const iso = toIsoAusDate(dateInput, now);
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

function daysBetweenIso(a, b) {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.round((db - da) / 86400000);
}

/**
 * When OCR misreads a month digit (20/08/26 → 20/06/26) on a same-day or
 * very recent thermal receipt, prefer the confusion alternative closest to today.
 */
function maybeRepairConfusedMonth(iso, now = new Date()) {
  if (!iso) return null;
  const parts = String(iso).split("-").map(Number);
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  const todayIso = isoFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate(), now);
  if (!todayIso) return null;

  const ageDays = daysBetweenIso(iso, todayIso);
  // Only repair dates that look "too old" for a fresh scan (2+ weeks), while
  // still in the same calendar year / plausible window.
  if (!(ageDays >= 14)) return null;

  const confusions = MONTH_DIGIT_CONFUSIONS[month] || [];
  let best = null;
  for (const altMonth of confusions) {
    const alt = isoFromParts(year, altMonth, day, now);
    if (!alt) continue;
    const altAge = daysBetweenIso(alt, todayIso);
    // Prefer alternatives within the last few days (typical for "scan now").
    if (altAge < 0 || altAge > 3) continue;
    if (!best || Math.abs(altAge) < Math.abs(daysBetweenIso(best, todayIso))) {
      best = alt;
    }
  }
  return best;
}

function boostEftposTimestamp(src, iso) {
  if (!iso || !src) return 0;
  const m = String(src).match(EFTPOS_TIMESTAMP_RE);
  if (!m) return 0;
  const tsIso = toIsoAusDate(m[1]);
  if (tsIso && tsIso === iso) return 45;
  return 0;
}

/**
 * Find the best document date in OCR text (AU day/month).
 * @returns {{ date: string, rank: number, label: string } | null}
 */
function extractBestDocumentDate(text, purpose = "expense", now = new Date()) {
  const src = String(text || "");
  if (!src.trim()) return null;

  let best = null;
  DMY_GLOBAL_RE.lastIndex = 0;
  let match;
  while ((match = DMY_GLOBAL_RE.exec(src)) != null) {
    let year = Number(match[3]);
    if (year < 100) {
      year = expandTwoDigitYear(year, now);
      if (year == null) continue;
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    const iso = isoFromParts(year, month, day, now);
    if (!iso) continue;

    const ctx = contextBefore(src, match.index);
    let rank = rankDateContext(ctx, purpose);
    rank += boostEftposTimestamp(src, iso);
    const repaired = maybeRepairConfusedMonth(iso, now);
    const useIso = repaired || iso;
    if (repaired) rank += 20;
    const candidate = { date: useIso, rank, label: ctx.slice(-40) };

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
    const iso = isoFromParts(Number(im[1]), Number(im[2]), Number(im[3]), now);
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
  now = new Date(),
} = {}) {
  const purposeKey = purpose === "income" ? "income" : "expense";
  const fromText = extractBestDocumentDate(rawText, purposeKey, now);
  const ocrIso = toIsoAusDate(ocrDate, now);
  const paymentIso = toIsoAusDate(payPeriod && payPeriod.paymentDate, now);
  const periodEndIso = toIsoAusDate(payPeriod && payPeriod.to, now);

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

  // Final pass: repair OCR month-digit confusion on the winning candidate when
  // the scan is clearly "today-ish" (e.g. 20/06/26 vs real 20/08/26).
  candidates.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  const top = candidates[0];
  const repaired = maybeRepairConfusedMonth(top.date, now);
  return repaired || top.date;
}

module.exports = {
  toIsoAusDate,
  financialYearForAusDate,
  extractBestDocumentDate,
  resolveDocumentDate,
  isValidCalendarYmd,
  isPlausibleDocumentYear,
  expandTwoDigitYear,
  maybeRepairConfusedMonth,
  DOCUMENT_YEAR_PAST,
  DOCUMENT_YEAR_FUTURE,
};
