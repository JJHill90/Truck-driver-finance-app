/**
 * Post-processing layer over the OCR result:
 *  - breaks a scanned total into typed components
 *    (income: Wages / PAYG tax / Superannuation / Entitlements / GST / Net;
 *     expense: line items + GST + grand total), and
 *  - assesses ATO compliance for transport-industry earnings/expenses
 *    (Super Guarantee %, PAYG withholding, reconciliation, reasonable-amount
 *     caps and the $300 substantiation threshold).
 *
 * This module is first-party (not one of the provided verbatim modules) and is
 * intentionally tolerant of missing OCR fields — anything not detected is
 * flagged for manual confirmation rather than assumed.
 */
const {
  getCurrentFinancialYear,
  TRUCK_DRIVER_MEALS,
  OVERTIME_MEAL_CAP,
  SUBSTANTIATION,
  getCategoryMeta,
} = require("./ato-standards");
const { parseMoney } = require("./receipt-ocr-money");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Super Guarantee rate by financial year (ATO). Defaults to 12% (2025-26+).
const SG_RATE = {
  "2023-24": 0.11,
  "2024-25": 0.115,
  "2025-26": 0.12,
  "2026-27": 0.12,
  "2027-28": 0.12,
};

function sgRate(fy) {
  return SG_RATE[fy] != null ? SG_RATE[fy] : 0.12;
}

function classifyLineItem(description) {
  const s = String(description || "").toLowerCase();
  if (/super|sgc|\bsg\b|superannuation/.test(s)) return "super";
  if (/tax|payg|paye|withh/.test(s)) return "tax";
  if (/entitle|leave|holiday|loading|allowance|overtime|penalt/.test(s)) return "entitlements";
  if (/net\s*pay|take\s*home/.test(s)) return "net";
  if (/\bgst\b/.test(s)) return "gst";
  if (/gross|wage|salary|ordinary|earnings|base\s*pay/.test(s)) return "wages";
  return null;
}

// Summary/payment lines that are not purchased items.
function isTotalLabel(s) {
  return /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|amount\s*payable|balance|total)\b/i.test(s);
}
function isGstLabel(s) {
  return /\bgst\b|\btax\b/i.test(s);
}
function isPaymentLabel(s) {
  return /\b(cash|change|eftpos|visa|master(card)?|amex|debit|credit|card|tender|rounding|round(ing)?|paid|payment|account)\b/i.test(s);
}

/**
 * Parse per-line entries from raw OCR text, labelling each with the actual text
 * that precedes the amount on the receipt (e.g. "Diesel", "AdBlue", "Coffee").
 * Returns [{ description, amount, raw }].
 */
function parseLabeledLineItems(text) {
  const out = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(.*?)[\s.:-]*\$?\s*(-?\d{1,4}(?:,\d{3})*\.\d{2})\s*$/);
    if (!m) continue;
    const amount = parseMoney(m[2]);
    if (!amount) continue;
    let desc = m[1].replace(/\s{2,}/g, " ").replace(/[.:\-_\s]+$/, "").trim();
    // Drop leading quantity/price noise like "2 x" or "450.3L @"
    desc = desc.replace(/\s*@.*$/, "").trim();
    if (desc.length < 2 || /^[\d.,x@]+$/i.test(desc)) continue;
    if (desc.length > 48) desc = desc.slice(0, 48).trim();
    out.push({ description: desc, amount, raw: line.trim() });
  }
  return out;
}

function sumLineItemsByType(lineItems) {
  const totals = {};
  for (const item of lineItems || []) {
    const type = classifyLineItem(item.description);
    if (!type) continue;
    totals[type] = round2((totals[type] || 0) + num(item.amount));
  }
  return totals;
}

/**
 * Build a typed component breakdown of the document total.
 * Returns { components: [{type,label,amount,detected,note}], kind }.
 */
function buildComponentBreakdown(ocr = {}, isIncome, financialYear) {
  const fy = financialYear || getCurrentFinancialYear();
  const lineTotals = sumLineItemsByType(ocr.lineItems);
  const components = [];

  if (isIncome) {
    // Prefer entries labelled exactly as they appear on the payslip / remittance.
    // rawTextPreview is populated for both PDF text extraction and image OCR.
    const docItems = parseLabeledLineItems(ocr.rawTextPreview || ocr.rawText || "");
    if (docItems.length) {
      const seen = new Set();
      let grossFromDoc = 0;
      let hasSuper = false;
      for (const it of docItems) {
        const amount = round2(it.amount);
        if (!amount) continue;
        const key = `${it.description.toLowerCase()}:${amount.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const type = classifyLineItem(it.description) || "line";
        components.push({ type, label: it.description, amount, detected: true });
        if (type === "super") hasSuper = true;
        if (type === "wages") grossFromDoc = Math.max(grossFromDoc, amount);
      }
      const grossDoc = grossFromDoc || round2(ocr.grossTotal || ocr.amount || 0);
      if (!hasSuper && grossDoc) {
        components.push({
          type: "super",
          label: `Superannuation (expected ${(sgRate(fy) * 100).toFixed(1)}%)`,
          amount: round2(grossDoc * sgRate(fy)),
          detected: false,
          note: "Not shown on document — expected Super Guarantee on ordinary time earnings.",
        });
      }
      return { kind: "income", components };
    }

    const gross = round2(lineTotals.wages || ocr.grossTotal || ocr.amount || 0);
    const taxDetected = lineTotals.tax || num(ocr.taxWithheld) || num(ocr.paygWithheld);
    const superDetected = lineTotals.super || num(ocr.superannuation) || num(ocr.super);
    const entitlements = lineTotals.entitlements || 0;
    const gst = num(ocr.gstAmount) || num(ocr.gst);
    const net = num(ocr.netPay) || lineTotals.net || 0;
    const taxable = num(ocr.taxableIncome);

    if (gross) components.push({ type: "wages", label: "Wages / gross pay", amount: gross, detected: true });

    if (taxDetected) {
      components.push({ type: "tax", label: "PAYG tax withheld", amount: round2(taxDetected), detected: true });
    } else if (gross && net && gross - net > 0) {
      components.push({
        type: "tax",
        label: "PAYG tax withheld (est.)",
        amount: round2(gross - net - superDetected),
        detected: false,
        note: "Estimated from gross minus net.",
      });
    }

    if (superDetected) {
      components.push({ type: "super", label: "Superannuation", amount: round2(superDetected), detected: true });
    } else if (gross) {
      components.push({
        type: "super",
        label: `Superannuation (expected ${(sgRate(fy) * 100).toFixed(1)}%)`,
        amount: round2(gross * sgRate(fy)),
        detected: false,
        note: "Not shown on document — expected Super Guarantee on ordinary time earnings.",
      });
    }

    if (entitlements) {
      components.push({ type: "entitlements", label: "Entitlements / allowances", amount: round2(entitlements), detected: true });
    }
    if (taxable) components.push({ type: "taxable", label: "Taxable income", amount: round2(taxable), detected: true });
    if (gst) components.push({ type: "gst", label: "GST", amount: round2(gst), detected: true });
    if (net) components.push({ type: "net", label: "Net pay", amount: round2(net), detected: true });

    return { kind: "income", components };
  }

  // Expense: label each entry with the text from the image where possible.
  // Prefer line entries parsed from the raw OCR text (real receipt labels);
  // fall back to the OCR's own lineItems (e.g. the OpenAI vision result).
  const rawItems = parseLabeledLineItems(ocr.rawTextPreview || ocr.rawText || "");
  const baseItems = (ocr.lineItems || []).filter((i) => num(i.amount));
  const source = rawItems.length ? rawItems : baseItems;

  let gst = num(ocr.gst) || num(ocr.gstAmount);
  let total = num(ocr.amount);
  const seen = new Set();

  for (const item of source) {
    const desc = String(item.description || "").trim();
    const amount = round2(item.amount);
    if (!amount) continue;
    const low = desc.toLowerCase();

    if (/subtotal|sub\s*total/.test(low)) {
      components.push({ type: "subtotal", label: "Subtotal", amount, detected: true });
      continue;
    }
    if (isGstLabel(low)) {
      if (!gst) gst = amount;
      continue;
    }
    if (isTotalLabel(low)) {
      if (!total) total = amount;
      continue;
    }
    if (isPaymentLabel(low)) continue; // cash/eftpos/change etc. — not a purchase

    const key = `${low}:${amount.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push({
      type: "line",
      label: desc || "Item",
      amount,
      detected: true,
    });
  }

  if (gst) components.push({ type: "gst", label: "GST", amount: round2(gst), detected: true });
  if (total) components.push({ type: "total", label: "Grand total", amount: round2(total), detected: true });
  return { kind: "expense", components };
}

const STATUS_RANK = { breach: 3, exceeds: 2, review: 1, within_policy: 0 };
function worstStatus(checks) {
  let worst = "within_policy";
  for (const c of checks) {
    if (STATUS_RANK[c.status] > STATUS_RANK[worst]) worst = c.status;
  }
  return worst;
}

const STATUS_LABEL = {
  within_policy: "Within ATO policy",
  review: "Needs review",
  exceeds: "Exceeds ATO limit",
  breach: "Possible compliance breach",
};

/** Assess an income document against ATO transport-industry standards. */
function assessIncomeCompliance(ocr = {}, breakdown = { components: [] }, financialYear) {
  const fy = financialYear || getCurrentFinancialYear();
  const rate = sgRate(fy);
  const comps = breakdown.components || [];
  const get = (type) => comps.find((c) => c.type === type);

  const gross = get("wages")?.amount || num(ocr.grossTotal) || num(ocr.amount);
  const superComp = get("super");
  const taxComp = get("tax");
  const net = get("net")?.amount || num(ocr.netPay);

  const checks = [];

  // 1. Superannuation Guarantee.
  if (gross) {
    const expected = round2(gross * rate);
    if (superComp && superComp.detected) {
      if (superComp.amount < expected * 0.95) {
        checks.push({
          name: "Superannuation Guarantee",
          status: "breach",
          message: `Super $${superComp.amount.toFixed(2)} is below the ${(rate * 100).toFixed(1)}% minimum ($${expected.toFixed(2)}) on gross $${gross.toFixed(2)}.`,
        });
      } else {
        checks.push({
          name: "Superannuation Guarantee",
          status: "within_policy",
          message: `Super $${superComp.amount.toFixed(2)} meets the ${(rate * 100).toFixed(1)}% SG minimum ($${expected.toFixed(2)}).`,
        });
      }
    } else {
      checks.push({
        name: "Superannuation Guarantee",
        status: "review",
        message: `Superannuation not shown — confirm ${(rate * 100).toFixed(1)}% SG ($${expected.toFixed(2)}) is paid on ordinary time earnings.`,
      });
    }
  }

  // 2. PAYG withholding.
  if (gross) {
    if (taxComp && taxComp.detected && taxComp.amount > 0) {
      const r = taxComp.amount / gross;
      if (r > 0.47) {
        checks.push({
          name: "PAYG withholding",
          status: "review",
          message: `Withholding ${(r * 100).toFixed(1)}% of gross looks high — verify tax scale / no-TFN rate.`,
        });
      } else {
        checks.push({
          name: "PAYG withholding",
          status: "within_policy",
          message: `PAYG tax withheld ($${taxComp.amount.toFixed(2)}, ${(r * 100).toFixed(1)}% of gross).`,
        });
      }
    } else {
      checks.push({
        name: "PAYG withholding",
        status: "review",
        message: "No PAYG tax withheld detected — verify TFN supplied and correct withholding.",
      });
    }
  }

  // 3. Net reconciliation (net ~= gross - tax).
  if (gross && net && taxComp && taxComp.detected) {
    const expectedNet = round2(gross - taxComp.amount);
    if (net < gross && Math.abs(net - expectedNet) > 1) {
      checks.push({
        name: "Net reconciliation",
        status: "review",
        message: `Net $${net.toFixed(2)} ≠ gross − tax ($${expectedNet.toFixed(2)}). Check for other pre/post-tax deductions.`,
      });
    } else {
      checks.push({
        name: "Net reconciliation",
        status: "within_policy",
        message: "Net pay reconciles with gross minus PAYG tax.",
      });
    }
  }

  const status = worstStatus(checks);
  return {
    scope: "income",
    financialYear: fy,
    status,
    statusLabel: STATUS_LABEL[status],
    checks,
    summary: buildSummary("Income", status, checks),
  };
}

/** Assess an expense receipt against ATO reasonable-amount and substantiation rules. */
function assessExpenseCompliance(ocr = {}, financialYear) {
  const fy = financialYear || getCurrentFinancialYear();
  const amount = num(ocr.amount);
  const category = ocr.suggestedCategory || "other_work";
  const checks = [];

  const mealCaps = {
    meals_breakfast: TRUCK_DRIVER_MEALS.breakfast.cap,
    meals_lunch: TRUCK_DRIVER_MEALS.lunch.cap,
    meals_dinner: TRUCK_DRIVER_MEALS.dinner.cap,
    overtime_meals: OVERTIME_MEAL_CAP,
  };

  if (mealCaps[category] != null && amount) {
    const cap = mealCaps[category];
    if (amount > cap) {
      checks.push({
        name: "Reasonable amount (meals)",
        status: "exceeds",
        message: `$${amount.toFixed(2)} exceeds the ATO reasonable amount $${cap.toFixed(2)} — only $${cap.toFixed(2)} is deductible without full substantiation.`,
      });
    } else {
      checks.push({
        name: "Reasonable amount (meals)",
        status: "within_policy",
        message: `$${amount.toFixed(2)} is within the ATO reasonable amount $${cap.toFixed(2)}.`,
      });
    }
  }

  if (amount > SUBSTANTIATION.totalWorkExpensesReceiptThreshold) {
    checks.push({
      name: "Substantiation",
      status: "review",
      message: `Claim over $${SUBSTANTIATION.totalWorkExpensesReceiptThreshold} — keep written evidence (receipt is stored).`,
    });
  }

  const meta = getCategoryMeta(category);
  if (meta && meta.workUseRequired) {
    checks.push({
      name: "Work-use apportionment",
      status: "review",
      message: `${meta.label} requires a work-use %. Set the work-use portion before claiming.`,
    });
  }

  const status = worstStatus(checks);
  return {
    scope: "expense",
    financialYear: fy,
    status: checks.length ? status : "within_policy",
    statusLabel: STATUS_LABEL[checks.length ? status : "within_policy"],
    checks,
    summary: buildSummary("Expense", checks.length ? status : "within_policy", checks),
  };
}

function buildSummary(scope, status, checks) {
  if (!checks.length) return `${scope}: no ATO compliance flags detected.`;
  const lead = STATUS_LABEL[status] || status;
  const flagged = checks.filter((c) => c.status !== "within_policy");
  if (!flagged.length) return `${scope}: ${lead}.`;
  return `${scope}: ${lead} — ${flagged.map((c) => c.name).join(", ")}.`;
}

/**
 * Full enrichment for a scan result.
 * @returns { componentBreakdown, compliance }
 */
function analyzeScan(ocr = {}, purpose = "expense", profile = {}) {
  const fy = profile.financialYear || getCurrentFinancialYear();
  const isIncome = purpose === "income" || ocr.documentType === "income";
  const breakdown = buildComponentBreakdown(ocr, isIncome, fy);
  const compliance = isIncome
    ? assessIncomeCompliance(ocr, breakdown, fy)
    : assessExpenseCompliance(ocr, fy);
  return { componentBreakdown: breakdown.components, breakdownKind: breakdown.kind, compliance };
}

module.exports = {
  buildComponentBreakdown,
  parseLabeledLineItems,
  assessIncomeCompliance,
  assessExpenseCompliance,
  analyzeScan,
  sgRate,
  round2,
};
