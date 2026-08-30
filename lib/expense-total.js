/**
 * First-party expense total picker for photo/PDF receipts.
 * Prefer dollar amounts directly linked to TOTAL / SALE TOTAL (and similar
 * payable labels) over card tenders, line items, or a weak OCR amount guess.
 *
 * Payment lines (EFTPOS / VISA / SALE AUD) are never chosen as the total on
 * their own, but they corroborate or repair a TOTAL-linked amount when OCR
 * glues an extra digit ($599.44) or drops dollars ($0.44).
 */
const { parseMoney } = require("./receipt-ocr-money");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Strongest → weakest payable-total labels. Subtotal / GST / payments excluded. */
const TOTAL_LABEL_SPECS = [
  { re: /\bsales?\s*total\b/i, label: "Sale total", rank: 100 },
  { re: /\bgrand\s*total\b/i, label: "Grand total", rank: 98 },
  { re: /\bpay\s*total\b/i, label: "Pay total", rank: 96 },
  { re: /\bamount\s*(?:due|payable)\b/i, label: "Amount due", rank: 94 },
  { re: /\bbalance\s*due\b/i, label: "Balance due", rank: 92 },
  { re: /\btotal\s*due\b/i, label: "Total due", rank: 90 },
  { re: /\binvoice\s*total\b/i, label: "Invoice total", rank: 88 },
  { re: /\btotal\s*payable\b/i, label: "Total payable", rank: 86 },
  // Bare TOTAL — still strong, but below "sale total" / "grand total".
  { re: /\btotal\b/i, label: "Total", rank: 80 },
];

const REJECT_LABEL_RE =
  /\b(sub\s*total|subtotal|total\s*gst|gst\s*total|total\s*tax|tax\s*total|total\s*includes?\b|total\s*items|item\s*total|qty|quantity|points|ytd|year[\s-]*to[\s-]*date|you\s*saved|specials?|saved|rewards?|cookware|points?\s*balance)\b/i;

const PAYMENT_LABEL_RE =
  /\b(cash|change|eftpos|eft|visa|master(?:card)?|amex|debit|credit|card|tender|rounding|paid|payment|account)\b/i;

/**
 * Card PAN / mask fragments OCR often glues into fake money
 * (e.g. VISA ************8822 → "5822.10" or "8822.10").
 */
function looksLikeCardPanFragment(raw, amount) {
  const s = String(raw || "");
  if (!s.trim()) return false;
  if (/\*{3,}|X{4,}|#{4,}|\bCARD\s*:|\bPAN\b|\*{2,}\d{2,}/i.test(s)) return true;
  // Masked last-4 then optional .cc glued on: ************8822.10
  const glued = s.match(/\*{2,}(\d{3,4})(?:\.(\d{2}))?/);
  if (glued) {
    const last4 = Number(glued[1]);
    const cents = glued[2] != null ? Number(glued[2]) / 100 : null;
    const v = round2(amount);
    if (Number.isFinite(last4) && Math.floor(v) === last4) return true;
    if (cents != null && Math.abs(v - (last4 + cents)) < 0.001) return true;
  }
  // "VISA … 5822.10" / "Visa (EBT CAD, 5822.1" — card line with a huge amount
  // and no purchase/paid wording on the same span.
  if (
    /\b(visa|master(?:card)?|amex|debit|credit|eft\s*cad|ebt)\b/i.test(s) &&
    !/\b(purchase|sale\s*aud|total\s*aud|amount\s*charged|paid)\b/i.test(s) &&
    round2(amount) >= 500
  ) {
    return true;
  }
  return false;
}

/** Payable totals on AU thermal receipts always include cents. */
const MONEY_CENTS = String.raw`\$?\s*(-?\d{1,4}(?:,\d{3})*\.\d{2})`;

const TENDER_LABEL_RE =
  /\b(?:eftpos|eft|visa|master(?:card)?|amex|debit|credit\s*card|card\s*payment|tender|sale\s*aud|aud)\b/i;

function isRejectedTotalLabel(label) {
  const s = String(label || "");
  if (REJECT_LABEL_RE.test(s)) return true;
  if (PAYMENT_LABEL_RE.test(s)) return true;
  return false;
}

function rankTotalLabel(label) {
  const s = String(label || "").trim();
  if (!s || isRejectedTotalLabel(s)) return 0;
  for (const spec of TOTAL_LABEL_SPECS) {
    if (spec.re.test(s)) return spec.rank;
  }
  return 0;
}

function canonicalTotalLabel(label) {
  const s = String(label || "").trim();
  for (const spec of TOTAL_LABEL_SPECS) {
    if (spec.re.test(s)) return spec.label;
  }
  return "Total";
}

function moneyAmountsIn(text) {
  const src = String(text || "");
  const out = [];
  const re = new RegExp(MONEY_CENTS, "gi");
  let m;
  while ((m = re.exec(src)) != null) {
    const amount = parseMoney(m[1]);
    if (amount) out.push(round2(amount));
  }
  return out;
}

function rightmostMoney(text) {
  const amounts = moneyAmountsIn(text);
  return amounts.length ? amounts[amounts.length - 1] : null;
}

function amountKey(amount) {
  return round2(amount).toFixed(2);
}

/**
 * True when `big` looks like OCR glued an extra leading digit onto `small`
 * (e.g. 599.44 vs 99.44, or 187.50 vs 87.50).
 */
function looksLikeGluedAmount(big, small) {
  const a = round2(big);
  const b = round2(small);
  if (!(a > b) || !(b > 0)) return false;
  const as = amountKey(a);
  const bs = amountKey(b);
  if (as === bs) return false;
  if (as.endsWith(bs) && as.length > bs.length && as.length - bs.length <= 2) {
    return true;
  }
  // "5" + "99.44" with a missing decimal glue already normalised by parseMoney.
  const aDigits = as.replace(/\D/g, "");
  const bDigits = bs.replace(/\D/g, "");
  return aDigits.length === bDigits.length + 1 && aDigits.endsWith(bDigits);
}

function isMicroAmount(amount) {
  return round2(amount) > 0 && round2(amount) < 1;
}

/** True when `amount` appears on a GST / tax line in the receipt text. */
function amountAppearsAsGst(text, amount) {
  const key = amountKey(amount);
  const src = String(text || "");
  if (!src.trim() || !(round2(amount) > 0)) return false;
  const re = new RegExp(
    String.raw`\b(?:gst|tax)\b[^0-9$]{0,24}${key.replace(".", "\\.")}|${key.replace(".", "\\.")}[^0-9]{0,12}\b(?:gst|tax)\b`,
    "i"
  );
  return re.test(src);
}

/** True when the labeled TOTAL also appears on PURCHASE / EFT / TOTAL AUD lines. */
function amountCorroboratedAsPayable(rawText, amount) {
  const key = amountKey(amount);
  const src = String(rawText || "");
  if (!src.trim() || !(round2(amount) > 0)) return false;
  // Do not treat GST/tax lines as payable corroboration.
  if (amountAppearsAsGst(src, amount)) return false;
  const re = new RegExp(
    String.raw`\b(?:purchase|sale\s*aud|total\s*aud|amount\s*charged|paid)\b[^0-9$]{0,24}${key.replace(".", "\\.")}|${key.replace(".", "\\.")}[^0-9]{0,12}\b(?:purchase|sale\s*aud|total\s*aud|amount\s*charged)\b`,
    "i"
  );
  return re.test(src);
}

/**
 * When TOTAL disagrees with tenders, only repair if TOTAL looks like GST or is
 * smaller than every tender (OCR latched the wrong figure). Never demote a
 * larger SALE TOTAL just because a partial VISA/EFTPOS line exists.
 * Never repair upward to a card-PAN fragment (************8822 → $5822.10).
 */
function shouldRepairLabeledAgainstTenders(hitAmount, tenders, rawText) {
  if (!tenders || !tenders.length) return false;
  const usable = (tenders || []).filter((t) => !looksLikeCardPanFragment(t.raw, t.amount));
  if (!usable.length) return false;
  const keys = tenderSet(usable);
  if (keys.has(amountKey(hitAmount))) return false;
  // Correct TOTAL is also on PURCHASE/EFT — do not replace with a larger tender.
  if (amountCorroboratedAsPayable(rawText, hitAmount)) return false;
  if (amountAppearsAsGst(rawText, hitAmount)) return true;
  if (isMicroAmount(hitAmount)) return true;
  return usable.every((t) => round2(t.amount) > round2(hitAmount) + 0.009);
}

/**
 * Card / EFTPOS / SALE AUD amounts — corroborate TOTAL labels, never primary alone.
 */
function extractPaymentTenders(text) {
  const src = String(text || "");
  if (!src.trim()) return [];

  const hits = [];
  const seen = new Set();

  function push(amount, raw) {
    const v = round2(amount);
    if (!(v > 0)) return;
    const span = String(raw || "").trim();
    if (looksLikeCardPanFragment(span, v)) return;
    const key = amountKey(v);
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ amount: v, raw: span });
  }

  const sameLine = new RegExp(`${TENDER_LABEL_RE.source}[^\\n\\d$]{0,32}${MONEY_CENTS}`, "gi");
  let m;
  while ((m = sameLine.exec(src)) != null) {
    // Skip GST / change clutter near the match.
    const around = src.slice(Math.max(0, m.index - 12), Math.min(src.length, m.index + m[0].length + 8));
    if (/\b(gst|change|cash\s*out)\b/i.test(around) && !/\b(eftpos|visa|sale\s*aud)\b/i.test(m[0])) {
      continue;
    }
    const amount = parseMoney(m[1]);
    if (amount) push(amount, m[0]);
  }

  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !TENDER_LABEL_RE.test(line)) continue;
    if (/\b(gst|change)\b/i.test(line) && !/\b(eftpos|visa|sale\s*aud)\b/i.test(line)) continue;
    const onLine = rightmostMoney(line);
    if (onLine) {
      push(onLine, line);
      continue;
    }
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (/^[-_=*.\s]+$/.test(next)) continue;
      const only = next.match(new RegExp(`^${MONEY_CENTS}$`, "i"));
      if (only && parseMoney(only[1])) {
        push(parseMoney(only[1]), `${line} ${next}`);
        break;
      }
      // Stop at the next labelled row so we do not steal the following total.
      if (rankTotalLabel(next) > 0 || TENDER_LABEL_RE.test(next) || REJECT_LABEL_RE.test(next)) {
        break;
      }
      const embedded = rightmostMoney(next);
      if (embedded && next.length <= 16) {
        push(embedded, `${line} ${next}`);
        break;
      }
      break;
    }
  }

  return hits;
}

/**
 * Pull payable totals that sit on the same line as (or immediately after) a
 * TOTAL / SALE TOTAL style label in OCR text.
 */
function extractLabeledExpenseTotals(text) {
  const src = String(text || "");
  if (!src.trim()) return [];

  const hits = [];
  const seen = new Set();

  function push(label, amount, rank, raw) {
    const v = round2(amount);
    if (!(v > 0)) return;
    const key = `${rank}:${amountKey(v)}:${String(label).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ label: canonicalTotalLabel(label), amount: v, rank, raw: String(raw || "").trim() });
  }

  // Same-line: "SALE TOTAL $187.50" / "Total: 45.00" / "SALE TOTAL:$99.44"
  for (const spec of TOTAL_LABEL_SPECS) {
    const re = new RegExp(`${spec.re.source}[^\\n\\d$]{0,24}${MONEY_CENTS}`, "gi");
    let m;
    while ((m = re.exec(src)) != null) {
      const around = src.slice(Math.max(0, m.index - 16), Math.min(src.length, m.index + m[0].length + 12));
      if (
        /sub\s*total|subtotal|total\s*gst|gst\s*total|total\s*tax|total\s*includes?/i.test(around) &&
        spec.rank <= 80
      ) {
        continue;
      }
      // Prefer the rightmost cents amount in the matched span (column-aligned totals).
      const spanAmounts = moneyAmountsIn(m[0]);
      const amount = spanAmounts.length ? spanAmounts[spanAmounts.length - 1] : parseMoney(m[1]);
      if (amount) push(spec.label, amount, spec.rank, m[0]);
    }
  }

  // Split line: "SALE TOTAL" then "$187.50" on a following money-only line.
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const rank = rankTotalLabel(line);
    if (!(rank > 0)) continue;

    const same = rightmostMoney(line);
    // Only trust same-line amount when the label text itself is the total row
    // (not a long item line that happens to contain the word "total").
    if (same && line.length <= 48) {
      push(line, same, rank, line);
      continue;
    }

    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (/^[-_=*.\s]+$/.test(next)) continue;
      const onlyMoney = next.match(new RegExp(`^${MONEY_CENTS}$`, "i"));
      if (onlyMoney && parseMoney(onlyMoney[1])) {
        push(line, parseMoney(onlyMoney[1]), rank, `${line} ${next}`);
        break;
      }
      // Short right-aligned amount lines sometimes keep a trailing currency code.
      const shortMoney = next.match(new RegExp(`^${MONEY_CENTS}\\s*(?:aud)?$`, "i"));
      if (shortMoney && parseMoney(shortMoney[1]) && next.length <= 16) {
        push(line, parseMoney(shortMoney[1]), rank, `${line} ${next}`);
        break;
      }
      break;
    }
  }

  hits.sort((a, b) => b.rank - a.rank || b.amount - a.amount);
  return hits;
}

function tenderSet(tenders) {
  return new Set((tenders || []).map((t) => amountKey(t.amount)));
}

function scoreCandidate(candidate, tenders, rawText = "") {
  const keys = tenderSet(tenders);
  let score = candidate.rank * 1000;
  const key = amountKey(candidate.amount);

  if (keys.has(key)) score += 500;
  if (isMicroAmount(candidate.amount)) score -= 800;
  if (amountCorroboratedAsPayable(rawText, candidate.amount)) score += 600;
  if (/\byou\s*saved\b|\bspecials?\b/i.test(String(candidate.raw || ""))) score -= 1200;

  for (const t of tenders || []) {
    if (looksLikeGluedAmount(candidate.amount, t.amount)) {
      score -= 900;
    }
  }

  // Soft preference for typical receipt totals over tiny leftovers.
  if (candidate.amount >= 1) score += 20;
  return score;
}

/**
 * Choose the expense amount that should be approved as the receipt total.
 * @returns {{ amount: number, label: string, rank: number, source: string } | null}
 */
function pickBestExpenseTotal({ ocrAmount = null, rawText = "", lineItems = [] } = {}) {
  const fromText = extractLabeledExpenseTotals(rawText);
  const tenders = extractPaymentTenders(rawText).filter(
    (t) => !looksLikeCardPanFragment(t.raw, t.amount)
  );
  const tenderKeys = tenderSet(tenders);

  const fromLines = [];
  for (const item of lineItems || []) {
    const label = item.description || item.label || "";
    const rank = rankTotalLabel(label);
    if (!(rank > 0)) continue;
    const amount = round2(item.amount);
    if (!(amount > 0)) continue;
    // Line-item totals without cents are rare; still accept if OCR structured them.
    fromLines.push({
      label: canonicalTotalLabel(label),
      amount,
      rank,
      raw: label,
    });
  }

  const pool = [];
  const seen = new Set();

  function addCandidate(base, { amount = base.amount, source = "labeled", repaired = false } = {}) {
    const v = round2(amount);
    if (!(v > 0)) return;
    const key = `${base.rank}:${amountKey(v)}:${String(base.label).toLowerCase()}:${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    const candidate = {
      label: base.label,
      amount: v,
      rank: base.rank,
      raw: base.raw,
      source,
      repaired,
    };
    candidate.score = scoreCandidate(candidate, tenders, rawText);
    // Repaired amounts that match a tender are strongly preferred over the glue.
    if (repaired && tenderKeys.has(amountKey(v))) candidate.score += 400;
    pool.push(candidate);
  }

  for (const hit of [...fromText, ...fromLines]) {
    addCandidate(hit, { source: "labeled" });

    // If SALE TOTAL OCR looks glued relative to a card/EFTPOS amount, offer the
    // tender figure under the same TOTAL label (United $599.44 → $99.44).
    for (const t of tenders) {
      if (looksLikeGluedAmount(hit.amount, t.amount)) {
        addCandidate(hit, { amount: t.amount, source: "labeled-repaired", repaired: true });
      }
    }

    // Micro TOTAL ($0.44) while EFTPOS/VISA shows the real payable → repair.
    if (isMicroAmount(hit.amount)) {
      for (const t of tenders) {
        if (t.amount >= 1) {
          addCandidate(hit, { amount: t.amount, source: "labeled-repaired", repaired: true });
        }
      }
    }

    // TOTAL amount is GST / too small vs every tender (BP TOTAL $1.54 + DEBIT $16.90).
    if (shouldRepairLabeledAgainstTenders(hit.amount, tenders, rawText)) {
      for (const t of tenders) {
        if (t.amount >= 1) {
          addCandidate(hit, { amount: t.amount, source: "labeled-repaired", repaired: true });
        }
      }
    }
  }

  pool.sort((a, b) => b.score - a.score || b.rank - a.rank || b.amount - a.amount);

  if (pool.length) {
    const best = pool[0];
    // Prefer a repaired tender twin when the labeled TOTAL was glued, micro,
    // GST-sized, or smaller than every card amount.
    const safer = pool.find(
      (c) =>
        c.rank === best.rank &&
        c.repaired &&
        tenderKeys.has(amountKey(c.amount)) &&
        (looksLikeGluedAmount(best.amount, c.amount) ||
          isMicroAmount(best.amount) ||
          shouldRepairLabeledAgainstTenders(best.amount, tenders, rawText))
    );
    const chosen = safer || best;
    return {
      amount: chosen.amount,
      label: chosen.label,
      rank: chosen.rank,
      source: chosen.source,
    };
  }

  // No TOTAL label — only then consider OCR amount / tender agreement.
  const fallback = round2(ocrAmount);
  if (fallback > 0) {
    // Drop OCR amounts that only appear on a card/PAN line in the raw text.
    const panLine = String(rawText || "")
      .split(/\r?\n/)
      .find((line) => {
        const amounts = moneyAmountsIn(line);
        return amounts.some((a) => Math.abs(a - fallback) < 0.005) && looksLikeCardPanFragment(line, fallback);
      });
    if (panLine) {
      /* fall through to tenders / null */
    } else if (tenderKeys.size && !tenderKeys.has(amountKey(fallback))) {
      const gluedTender = tenders.find((t) => looksLikeGluedAmount(fallback, t.amount));
      if (gluedTender) {
        return {
          amount: gluedTender.amount,
          label: "Total",
          rank: 20,
          source: "ocr-repaired",
        };
      }
      // OCR amount conflicts with every tender and looks like GST / too small.
      if (shouldRepairLabeledAgainstTenders(fallback, tenders, rawText)) {
        const top = [...tenders].sort((a, b) => b.amount - a.amount)[0];
        return { amount: top.amount, label: "Total", rank: 18, source: "tender-preferred" };
      }
      return { amount: fallback, label: "Total", rank: 20, source: "ocr" };
    } else {
      return { amount: fallback, label: "Total", rank: 20, source: "ocr" };
    }
  }

  if (tenders.length) {
    const top = [...tenders].sort((a, b) => b.amount - a.amount)[0];
    return { amount: top.amount, label: "Total", rank: 15, source: "tender" };
  }

  return null;
}

/**
 * After mergeDetectedTotals, force the primary to a TOTAL/SALE TOTAL-linked amount
 * when raw text/components prove a stronger payable total exists.
 */
function refineExpenseDetectedTotals(detectedTotals, ocrResult = {}, components = []) {
  const purposeItems = (components || [])
    .filter((c) => c && c.detected !== false)
    .map((c) => ({ description: c.label, amount: c.amount }));

  const best = pickBestExpenseTotal({
    ocrAmount: ocrResult.amount,
    rawText: ocrResult.rawText || ocrResult.rawTextPreview || "",
    lineItems: [...purposeItems, ...(ocrResult.lineItems || [])],
  });

  const out = Array.isArray(detectedTotals) ? detectedTotals.map((t) => ({ ...t })) : [];
  if (!best) {
    return out;
  }

  // Ensure the winning total is present and primary.
  let row = out.find((t) => Math.abs(Number(t.amount) - best.amount) < 0.005);
  if (!row) {
    row = { label: best.label, amount: best.amount, primary: false };
    out.unshift(row);
  } else if (best.rank >= 80) {
    // Prefer the stronger TOTAL/SALE TOTAL wording when we found one.
    row.label = best.label;
  }

  for (const t of out) t.primary = false;
  row.primary = true;
  out.sort((a, b) => Number(b.primary) - Number(a.primary) || b.amount - a.amount);
  return out;
}

module.exports = {
  extractLabeledExpenseTotals,
  extractPaymentTenders,
  pickBestExpenseTotal,
  refineExpenseDetectedTotals,
  rankTotalLabel,
  canonicalTotalLabel,
  isRejectedTotalLabel,
  looksLikeGluedAmount,
  looksLikeCardPanFragment,
  amountCorroboratedAsPayable,
  shouldRepairLabeledAgainstTenders,
};
