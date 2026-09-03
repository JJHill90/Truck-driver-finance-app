/**
 * Extract PAYG / income tax withheld from a payslip OCR result or breakdown.
 * Used for the dashboard “Gross income vs Income tax” visual only — does not
 * feed the tax calculator or other money logic.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Absolute PAYG / withholding dollars from component breakdown rows.
 */
function taxWithheldFromBreakdown(breakdown) {
  const comps = Array.isArray(breakdown)
    ? breakdown
    : breakdown && Array.isArray(breakdown.components)
      ? breakdown.components
      : [];
  let total = 0;
  for (const c of comps) {
    if (!c) continue;
    const type = String(c.type || "").toLowerCase();
    const label = String(c.label || c.description || "");
    const isTax =
      type === "tax" ||
      /\b(payg|paye|withhold|income\s*tax|tax\s*withheld)\b/i.test(label);
    if (!isTax) continue;
    // Prefer detected rows; still accept estimated withholding if that is all we have.
    const amt = Math.abs(num(c.amount));
    if (amt > 0) total += amt;
  }
  return total > 0 ? round2(total) : 0;
}

/**
 * Parse PAYG / tax withheld from raw payslip text (e.g. "PAYG Withholding -$738.00").
 */
function taxWithheldFromText(rawText) {
  const text = String(rawText || "");
  if (!text.trim()) return 0;

  const patterns = [
    /payg\s*withhold(?:ing|ings|n)?[^$\d\n]{0,40}(-?\s*\$?\s*[\d,]+(?:\.\d{1,2})?)/i,
    /(?:payg|paye)\s*(?:tax)?[^$\d\n]{0,40}(-?\s*\$?\s*[\d,]+(?:\.\d{1,2})?)/i,
    /(?:income\s*tax|tax\s*withheld|withholding\s*tax)[^$\d\n]{0,40}(-?\s*\$?\s*[\d,]+(?:\.\d{1,2})?)/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const raw = String(m[1] || "").replace(/[$,\s]/g, "");
    const amt = Math.abs(Number(raw));
    if (Number.isFinite(amt) && amt > 0) return round2(amt);
  }
  return 0;
}

/**
 * Best available tax withheld from an OCR payload (+ optional breakdown).
 */
function extractTaxWithheld(ocrResult, breakdown) {
  if (!ocrResult || typeof ocrResult !== "object") {
    return taxWithheldFromBreakdown(breakdown);
  }
  const direct =
    num(ocrResult.taxWithheld) ||
    num(ocrResult.paygWithheld) ||
    num(ocrResult.paygTax) ||
    num(ocrResult.incomeTaxWithheld);
  if (direct > 0) return round2(Math.abs(direct));

  const fromBreak = taxWithheldFromBreakdown(
    breakdown || ocrResult.componentBreakdown || ocrResult.components
  );
  if (fromBreak > 0) return fromBreak;

  return taxWithheldFromText(ocrResult.rawText || ocrResult.rawTextPreview || "");
}

/**
 * Attach taxWithheld onto an income ledger entry (mutates entry).
 */
function attachIncomeTaxWithheld(entry, payload, receipt) {
  if (!entry || typeof entry !== "object") return entry;
  let tax =
    num(payload && (payload.taxWithheld ?? payload.paygWithheld)) ||
    num(entry.taxWithheld ?? entry.paygWithheld);
  if (!(tax > 0) && receipt && receipt.ocrResult) {
    tax = extractTaxWithheld(receipt.ocrResult);
  }
  if (!(tax > 0) && receipt && receipt.manual) {
    tax = num(receipt.manual.taxWithheld ?? receipt.manual.paygWithheld);
  }
  if (tax > 0) {
    entry.taxWithheld = round2(Math.abs(tax));
  }
  return entry;
}

/**
 * FY totals for the dashboard Gross vs Income-tax doughnut (visual only).
 */
function payslipTaxVisualFromRecords(records, financialYear, { getFinancialYearForDate } = {}) {
  const income = (records && records.income) || [];
  const receipts = (records && records.receipts) || [];
  const receiptById = new Map(receipts.map((r) => [r.id, r]));

  let grossIncome = 0;
  let incomeTax = 0;
  let counted = 0;

  for (const entry of income) {
    if (!entry || entry.deletedAt) continue;
    if (
      financialYear &&
      typeof getFinancialYearForDate === "function" &&
      getFinancialYearForDate(entry.date) !== financialYear
    ) {
      continue;
    }
    const gross = num(entry.grossTotal != null ? entry.grossTotal : entry.amount);
    let tax = num(entry.taxWithheld ?? entry.paygWithheld);
    if (!(tax > 0) && entry.receiptId) {
      const receipt = receiptById.get(entry.receiptId);
      if (receipt && receipt.ocrResult) {
        tax = extractTaxWithheld(receipt.ocrResult);
      }
    }
    if (gross > 0) {
      grossIncome = round2(grossIncome + gross);
      counted += 1;
    }
    if (tax > 0) incomeTax = round2(incomeTax + Math.abs(tax));
  }

  const taxOfGrossPct =
    grossIncome > 0 ? Math.round((incomeTax / grossIncome) * 1000) / 10 : null;

  return {
    grossIncome,
    incomeTax,
    taxOfGrossPct,
    entryCount: counted,
  };
}

module.exports = {
  extractTaxWithheld,
  taxWithheldFromBreakdown,
  taxWithheldFromText,
  attachIncomeTaxWithheld,
  payslipTaxVisualFromRecords,
  round2,
};
