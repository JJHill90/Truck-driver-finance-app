/**
 * Fuel tax credit estimate for Hub diesel receipts.
 *
 * Two ATO liquid-fuel rates (cents per litre) for the date the fuel was
 * acquired. The driver picks one on the receipt:
 * - on_road: heavy vehicle travelling on public roads (excise minus road user charge)
 * - off_road: all other business uses, including auxiliary equipment of a
 *   heavy vehicle (the higher rate)
 *
 * This is an estimate for BAS label 7D — not a lodged claim.
 * Source: ATO "Fuel tax credit rates for business" (1 July 2026 – 30 June 2027
 * tables, and the prior indexation periods).
 */

const USES = {
  on_road: "Heavy vehicle on public roads",
  off_road: "Off-road or auxiliary equipment (higher rate)",
};

const RATE_PERIODS = [
  { from: "2026-08-03", onRoadCents: 21.3, offRoadCents: 53.7 },
  { from: "2026-07-01", onRoadCents: 20.2, offRoadCents: 36.6 },
  { from: "2026-04-01", onRoadCents: 20.6, offRoadCents: 20.6 },
  { from: "2026-02-02", onRoadCents: 20.2, offRoadCents: 52.6 },
  { from: "2025-08-04", onRoadCents: 19.2, offRoadCents: 51.6 },
  { from: "2025-07-01", onRoadCents: 18.4, offRoadCents: 50.8 },
  { from: "2025-02-03", onRoadCents: 20.3, offRoadCents: 50.8 },
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function ratesForDate(dateIso) {
  const date = String(dateIso || "").slice(0, 10);
  const ordered = [...RATE_PERIODS].sort((a, b) => b.from.localeCompare(a.from));
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    for (const row of ordered) {
      if (date >= row.from) return row;
    }
  }
  return ordered[0];
}

function normaliseUse(use) {
  const key = String(use || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "off_road" || key === "offroad" || key === "auxiliary") return "off_road";
  return "on_road";
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

function estimateFuelTaxCredit({ litres, date, text, use } = {}) {
  const fromText = extractDieselLitres(text);
  const qty = round2(litres != null && Number(litres) > 0 ? litres : fromText);
  if (!(qty > 0)) return null;
  const period = ratesForDate(date);
  const chosenUse = normaliseUse(use);
  const options = ["on_road", "off_road"].map((id) => {
    const cents = id === "off_road" ? period.offRoadCents : period.onRoadCents;
    return {
      id,
      label: USES[id],
      centsPerLitre: cents,
      amount: round2((qty * cents) / 100),
    };
  });
  const chosen = options.find((row) => row.id === chosenUse) || options[0];
  return {
    litres: qty,
    use: chosen.id,
    centsPerLitre: chosen.centsPerLitre,
    amount: chosen.amount,
    acquiredFrom: period.from,
    basLabel: "7D",
    options,
    note: `${chosen.label}: ${qty} L × ${chosen.centsPerLitre}c = $${chosen.amount.toFixed(2)} (fuel acquired from ${period.from}). BAS label 7D estimate from the ATO rate table. Not a lodged claim.`,
  };
}

/** 7D is calculated only from litres and use the driver stored. Receipt text is ignored. */
function creditFromStoredInputs({ category, dieselLitres, date, use } = {}) {
  if (category !== "fuel") return null;
  const litres = Number(dieselLitres);
  if (!(litres > 0)) return null;
  return estimateFuelTaxCredit({ litres, date, use });
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
  USES,
  RATE_PERIODS,
  ratesForDate,
  normaliseUse,
  extractDieselLitres,
  estimateFuelTaxCredit,
  creditFromStoredInputs,
  sumFuelTaxCredits,
};
