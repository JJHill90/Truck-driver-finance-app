/**
 * Fuel tax credit estimate for Hub diesel receipts.
 *
 * Rates are the ATO heavy-vehicle on-public-roads liquid-fuel rates
 * (cents per litre) by the date the fuel was acquired. This is an estimate
 * for BAS label 7D — not a lodged claim. Off-road / auxiliary use is higher
 * and is not assumed.
 *
 * Source: ATO "Fuel tax credit rates for business" (1 July 2026 – 30 June 2027
 * tables, and the prior indexation periods).
 */

const RATE_PERIODS = [
  { from: "2026-08-03", centsPerLitre: 21.3, note: "Heavy vehicle on public roads from 3 August 2026" },
  { from: "2026-07-01", centsPerLitre: 20.2, note: "Heavy vehicle on public roads 1 July–2 August 2026" },
  { from: "2026-04-01", centsPerLitre: 20.6, note: "Heavy vehicle on public roads 1 April–30 June 2026" },
  { from: "2026-02-02", centsPerLitre: 20.2, note: "Heavy vehicle on public roads 2 February–31 March 2026" },
  { from: "2025-08-04", centsPerLitre: 19.2, note: "Heavy vehicle on public roads 4 August 2025–1 February 2026" },
  { from: "2025-07-01", centsPerLitre: 18.4, note: "Heavy vehicle on public roads 1 July–3 August 2025" },
  { from: "2025-02-03", centsPerLitre: 20.3, note: "Heavy vehicle on public roads 3 February–30 June 2025" },
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function rateForDate(dateIso) {
  const date = String(dateIso || "").slice(0, 10);
  const ordered = [...RATE_PERIODS].sort((a, b) => b.from.localeCompare(a.from));
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    for (const row of ordered) {
      if (date >= row.from) return row;
    }
  }
  return ordered[0];
}

/**
 * Litres of diesel / distillate. Ignores AdBlue (not taxed as diesel).
 * "Diesel 412.00L @ 2.049" → 412.
 */
function extractDieselLitres(text) {
  const src = String(text || "");
  if (!src.trim()) return null;
  const patterns = [
    /\bdiesel\b[^|\n]{0,40}?(\d+(?:\.\d+)?)\s*l\b/i,
    /\b(\d+(?:\.\d+)?)\s*l\b[^|\n]{0,24}\bdiesel\b/i,
    /\bdistillate\b[^|\n]{0,40}?(\d+(?:\.\d+)?)\s*l\b/i,
  ];
  for (const re of patterns) {
    const m = src.match(re);
    if (!m) continue;
    const litres = Number(m[1]);
    if (litres > 0 && litres < 10000) return round2(litres);
  }
  return null;
}

function estimateFuelTaxCredit({ litres, date, text } = {}) {
  const fromText = extractDieselLitres(text);
  const qty = round2(litres != null && Number(litres) > 0 ? litres : fromText);
  if (!(qty > 0)) return null;
  const rate = rateForDate(date);
  const amount = round2((qty * rate.centsPerLitre) / 100);
  return {
    litres: qty,
    centsPerLitre: rate.centsPerLitre,
    amount,
    acquiredFrom: rate.from,
    basLabel: "7D",
    note: `${rate.note}. Estimate ${qty} L × ${rate.centsPerLitre}c = $${amount.toFixed(2)} for BAS label 7D. Confirm the rate for the day you bought the fuel. Not a lodged claim.`,
  };
}

function sumFuelTaxCredits(expenses = []) {
  let amount = 0;
  let litres = 0;
  let count = 0;
  for (const row of expenses || []) {
    if (!row || row.deletedAt) continue;
    const credit = row.fuelTaxCredit;
    const value = credit && Number(credit.amount);
    if (!(value > 0)) continue;
    amount = round2(amount + value);
    litres = round2(litres + (Number(credit.litres) || 0));
    count += 1;
  }
  return {
    basLabel: "7D",
    amount,
    litres,
    count,
    note:
      count > 0
        ? `Estimated fuel tax credit $${amount.toFixed(2)} from ${litres} L of diesel on ${count} receipt(s). Copy to BAS label 7D after you check the ATO rate for each purchase date.`
        : "",
  };
}

module.exports = {
  RATE_PERIODS,
  rateForDate,
  extractDieselLitres,
  estimateFuelTaxCredit,
  sumFuelTaxCredits,
};
