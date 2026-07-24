/**
 * Detect possible duplicate receipts / invoices by date + vendor + amount.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeDate(dateInput) {
  if (dateInput == null || dateInput === "") return null;
  const s = String(dateInput).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeVendor(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(pty|ltd|limited|australia|aust|the|co|company|inc|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function vendorsMatch(a, b) {
  const na = normalizeVendor(a);
  const nb = normalizeVendor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function amountsMatch(a, b) {
  const aa = round2(a);
  const bb = round2(b);
  if (!(aa > 0) || !(bb > 0)) return false;
  return aa === bb;
}

function candidateFromOcr(ocrResult, purpose, primaryAmount) {
  const o = ocrResult || {};
  const date = normalizeDate(o.date);
  const vendor =
    purpose === "income" ? o.entity || o.vendor || o.payer || "" : o.vendor || o.entity || "";
  let amount = null;
  if (purpose === "income") {
    amount = o.grossTotal ?? o.amount ?? o.taxableIncome ?? primaryAmount;
  } else {
    amount = o.amount ?? primaryAmount;
  }
  amount = round2(amount);
  if (!date || !normalizeVendor(vendor) || !(amount > 0)) return null;
  return { date, vendor: String(vendor).trim(), amount };
}

function pushMatch(out, seen, entry) {
  const key = `${entry.source}:${entry.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(entry);
}

function receiptPurpose(receipt) {
  if (!receipt) return null;
  if (receipt.purpose === "income" || receipt.purpose === "expense") return receipt.purpose;
  if (receipt.linkedIncomeId) return "income";
  if (receipt.linkedExpenseId) return "expense";
  const doc = receipt.ocrResult?.documentType || receipt.manual?.documentKind;
  if (doc === "income" || doc === "payslip" || doc === "remittance") return "income";
  return "expense";
}

/**
 * Find existing ledger / receipt rows that match date + vendor + amount.
 * Scoped by purpose so expense receipts don't block income payslip uploads
 * (and vice versa).
 */
function findDuplicateMatches(records, ocrResult, purpose, primaryAmount) {
  const cand = candidateFromOcr(ocrResult, purpose, primaryAmount);
  if (!cand) return [];

  const out = [];
  const seen = new Set();
  const isIncome = purpose === "income";

  if (isIncome) {
    for (const i of records.income || []) {
      const amount = i.grossTotal != null ? i.grossTotal : i.amount;
      if (
        normalizeDate(i.date) === cand.date &&
        amountsMatch(amount, cand.amount) &&
        vendorsMatch(i.entity || i.payer || "", cand.vendor)
      ) {
        pushMatch(out, seen, {
          source: "income",
          id: i.id,
          date: i.date,
          vendor: i.entity || i.payer || "",
          amount: round2(amount),
        });
      }
    }
  } else {
    for (const e of records.expenses || []) {
      if (
        normalizeDate(e.date) === cand.date &&
        amountsMatch(e.amount, cand.amount) &&
        vendorsMatch(e.vendor || "", cand.vendor)
      ) {
        pushMatch(out, seen, {
          source: "expense",
          id: e.id,
          date: e.date,
          vendor: e.vendor || "",
          amount: round2(e.amount),
        });
      }
    }
  }

  for (const r of records.receipts || []) {
    if (receiptPurpose(r) !== (isIncome ? "income" : "expense")) continue;
    const src = r.manual || r.ocrResult || {};
    const vendor = isIncome ? src.entity || src.vendor || src.payer || "" : src.vendor || src.entity || "";
    const amount = isIncome ? src.grossTotal ?? src.amount : src.amount;
    if (
      normalizeDate(src.date) === cand.date &&
      amountsMatch(amount, cand.amount) &&
      vendorsMatch(vendor, cand.vendor)
    ) {
      pushMatch(out, seen, {
        source: "receipt",
        id: r.id,
        date: src.date,
        vendor,
        amount: round2(amount),
        filename: r.filename || null,
      });
    }
  }

  return out;
}

module.exports = {
  normalizeDate,
  normalizeVendor,
  vendorsMatch,
  amountsMatch,
  candidateFromOcr,
  findDuplicateMatches,
  receiptPurpose,
};
