function parseMoney(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100;
  }
  const cleaned = String(value)
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function uniqueAmounts(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const amount = parseMoney(raw);
    if (!amount) continue;
    const key = amount.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(amount);
  }
  return out;
}

module.exports = { parseMoney, uniqueAmounts };
