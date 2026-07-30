/**
 * First-party expense total picker for photo/PDF receipts.
 * Prefer dollar amounts directly linked to TOTAL / SALE TOTAL (and similar
 * payable labels) over card tenders, line items, or a weak OCR amount guess.
 */
const { parseMoney } = require("./receipt-ocr-money");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Strongest → weakest payable-total labels. Subtotal / GST / payments excluded. */
const TOTAL_LABEL_SPECS = [
  { re: /\bsale\s*total\b/i, label: "Sale total", rank: 100 },
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
  /\b(sub\s*total|subtotal|total\s*gst|gst\s*total|total\s*tax|tax\s*total|total\s*items|item\s*total|qty|quantity|points|ytd|year[\s-]*to[\s-]*date)\b/i;

const PAYMENT_LABEL_RE =
  /\b(cash|change|eftpos|eft|visa|master(?:card)?|amex|debit|credit|card|tender|rounding|paid|payment|account)\b/i;

const MONEY_TOKEN = String.raw`\$?\s*(-?\d{1,4}(?:,\d{3})*(?:\.\d{2})?)`;

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
    const key = `${rank}:${v.toFixed(2)}:${String(label).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ label: canonicalTotalLabel(label), amount: v, rank, raw: String(raw || "").trim() });
  }

  // Same-line: "SALE TOTAL $187.50" / "Total: 45.00"
  for (const spec of TOTAL_LABEL_SPECS) {
    const re = new RegExp(`${spec.re.source}[^\\n\\d$]{0,24}${MONEY_TOKEN}`, "gi");
    let m;
    while ((m = re.exec(src)) != null) {
      const around = src.slice(Math.max(0, m.index - 16), Math.min(src.length, m.index + m[0].length + 12));
      if (/sub\s*total|subtotal|total\s*gst|gst\s*total|total\s*tax/i.test(around) && spec.rank <= 80) {
        continue;
      }
      const amount = parseMoney(m[1]);
      if (amount) push(spec.label, amount, spec.rank, m[0]);
    }
  }

  // Split line: "SALE TOTAL" then "$187.50" on the next non-empty line.
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const rank = rankTotalLabel(line);
    if (!(rank > 0)) continue;
    // Amount on same line?
    const same = line.match(new RegExp(`${MONEY_TOKEN}\\s*$`, "i"));
    if (same && parseMoney(same[1])) {
      push(line, parseMoney(same[1]), rank, line);
      continue;
    }
    // Look ahead up to 2 lines for a lone money amount.
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      const onlyMoney = next.match(new RegExp(`^${MONEY_TOKEN}$`, "i"));
      if (onlyMoney && parseMoney(onlyMoney[1])) {
        push(line, parseMoney(onlyMoney[1]), rank, `${line} ${next}`);
      }
      break;
    }
  }

  hits.sort((a, b) => b.rank - a.rank || b.amount - a.amount);
  return hits;
}

/**
 * Choose the expense amount that should be approved as the receipt total.
 * @returns {{ amount: number, label: string, rank: number, source: string } | null}
 */
function pickBestExpenseTotal({ ocrAmount = null, rawText = "", lineItems = [] } = {}) {
  const fromText = extractLabeledExpenseTotals(rawText);
  const fromLines = [];
  for (const item of lineItems || []) {
    const label = item.description || item.label || "";
    const rank = rankTotalLabel(label);
    if (!(rank > 0)) continue;
    const amount = round2(item.amount);
    if (!(amount > 0)) continue;
    fromLines.push({
      label: canonicalTotalLabel(label),
      amount,
      rank,
      raw: label,
    });
  }

  const pool = [...fromText, ...fromLines].sort(
    (a, b) => b.rank - a.rank || b.amount - a.amount
  );

  if (pool.length) {
    const best = pool[0];
    return {
      amount: best.amount,
      label: best.label,
      rank: best.rank,
      source: "labeled",
    };
  }

  const fallback = round2(ocrAmount);
  if (fallback > 0) {
    return { amount: fallback, label: "Total", rank: 20, source: "ocr" };
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
  } else {
    // Prefer the stronger TOTAL/SALE TOTAL wording when we found one.
    if (best.rank >= 80) row.label = best.label;
  }

  for (const t of out) t.primary = false;
  row.primary = true;
  out.sort((a, b) => Number(b.primary) - Number(a.primary) || b.amount - a.amount);
  return out;
}

module.exports = {
  extractLabeledExpenseTotals,
  pickBestExpenseTotal,
  refineExpenseDetectedTotals,
  rankTotalLabel,
  canonicalTotalLabel,
  isRejectedTotalLabel,
};
