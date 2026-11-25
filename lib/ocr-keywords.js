/**
 * Repair thermal-print keywords before money and vendor parsing.
 * 1/I/l, 0/O and 5/S are the usual swaps; T is often read as 1 (1oTAL).
 */

const KEYWORDS = [
  "TOTAL",
  "SUBTOTAL",
  "GST",
  "ABN",
  "DIESEL",
  "UNLEADED",
  "VISA",
  "EFTPOS",
  "MASTERCARD",
  "AMEX",
  "CASH",
  "RECEIPT",
  "INVOICE",
  "LITRES",
];

const CONFUSABLE = {
  "0": "o",
  o: "0",
  "1": "ilt",
  i: "1l",
  l: "1i",
  "5": "s",
  s: "5",
  t: "1",
};

function sameGlyph(a, b) {
  if (a === b) return true;
  const left = CONFUSABLE[a] || "";
  const right = CONFUSABLE[b] || "";
  return left.includes(b) || right.includes(a);
}

function similarKeyword(token) {
  const raw = String(token || "");
  const word = raw.replace(/[^A-Za-z0-9]/g, "");
  if (word.length < 2) return "";
  const lower = word.toLowerCase();
  for (const keyword of KEYWORDS) {
    if (lower === keyword.toLowerCase()) return keyword;
    if (lower.length !== keyword.length) continue;
    let ok = true;
    for (let i = 0; i < lower.length; i += 1) {
      if (!sameGlyph(lower[i], keyword[i].toLowerCase())) {
        ok = false;
        break;
      }
    }
    if (ok) return keyword;
  }
  return "";
}

function repairOcrKeywords(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      let next = line.replace(/\b53\s+included\b/gi, "GST INCLUDED");
      next = next.replace(/\b[6g][5s][t7]\b/g, "GST");
      return next
        .split(/(\s+)/)
        .map((part) => {
          if (!part || /^\s+$/.test(part)) return part;
          const fixed = similarKeyword(part);
          return fixed || part;
        })
        .join("");
    })
    .join("\n");
}

function cleanPartyName(raw) {
  let s = String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/[,;:]+$/g, "")
    .trim();
  const keep = new Set(["co", "au", "nz", "uk", "sa", "wa", "nt", "no", "pt", "lp"]);
  s = s.replace(/\s+([A-Za-z]{1,2})$/, (all, frag) => (keep.has(frag.toLowerCase()) ? all : ""));
  return s.slice(0, 80);
}

module.exports = {
  repairOcrKeywords,
  similarKeyword,
  cleanPartyName,
};
