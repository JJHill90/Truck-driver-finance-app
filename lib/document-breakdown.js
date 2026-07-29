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
const { COMBINED_MEALS_CAP } = require("./expense-menu");
const { parseMoney } = require("./receipt-ocr-money");
const { sgRateForYear } = require("./historical-rates");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Super Guarantee rate by financial year (delegates to the verified historical table).
function sgRate(fy) {
  return sgRateForYear(fy);
}

// Exact ATO reasonable daily meal amount for employee truck drivers (TD 2025/4),
// sourced from ato-standards (breakfast + lunch + dinner) so it tracks future
// determinations. Shown as a separate line regardless of whether the payslip
// lists it (it is sometimes shown on a payslip as "Travel Allowance").
const DAILY_OVERNIGHT_ALLOWANCE = round2(
  TRUCK_DRIVER_MEALS.breakfast.cap + TRUCK_DRIVER_MEALS.lunch.cap + TRUCK_DRIVER_MEALS.dinner.cap
);

/** Inclusive number of days in a pay period; defaults to a weekly 7 days. */
function daysInPeriod(payPeriod) {
  if (payPeriod && payPeriod.from && payPeriod.to) {
    const a = new Date(`${payPeriod.from}T00:00:00`);
    const b = new Date(`${payPeriod.to}T00:00:00`);
    const days = Math.round((b - a) / 86400000) + 1;
    if (days > 0 && days <= 366) return days;
  }
  return 7;
}

// --- Pay period / payment date -------------------------------------------
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_RE = "(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4})";

function parseAusDate(s) {
  const m = String(s || "").match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const dt = new Date(year, Number(m[2]) - 1, Number(m[1])); // AU day/month/year
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function isoDate(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function longLabel(dt) {
  return `${WEEKDAYS[dt.getDay()]} ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function ddmmyyyy(dt) {
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

/**
 * Extract the pay period (from/to) and payment date from payslip/remittance
 * text, and derive the weekly Wed→Tue cycle window the payslip falls into.
 */
function computePayPeriod(text) {
  const src = String(text || "");
  let from = null;
  let to = null;
  let payment = null;

  const pp = src.match(new RegExp(`pay\\s*period[^\\d]*${DATE_RE}[^\\d]*?${DATE_RE}`, "i"));
  if (pp) {
    from = parseAusDate(pp[1]);
    to = parseAusDate(pp[2]);
  }
  if (!from || !to) {
    const fr = src.match(new RegExp(`from[:\\s]*${DATE_RE}[^\\d]*?to[:\\s]*${DATE_RE}`, "i"));
    if (fr) {
      from = parseAusDate(fr[1]);
      to = parseAusDate(fr[2]);
    }
  }
  const pm = src.match(
    new RegExp(`(?:payment\\s*date|date\\s*paid|pay\\s*date|paid\\s*on|date\\s*of\\s*payment)[:\\s]*${DATE_RE}`, "i")
  );
  if (pm) payment = parseAusDate(pm[1]);

  // Derive the Wed→Tue window from the payment date when no explicit period.
  if ((!from || !to) && payment) {
    const end = new Date(payment);
    const back = (end.getDay() - 2 + 7) % 7; // walk back to the Tuesday on/before payday
    end.setDate(end.getDate() - back);
    to = end;
    from = new Date(end);
    from.setDate(from.getDate() - 6); // the preceding Wednesday
  }

  if (!from && !to && !payment) return null;

  const cycleLabel = from && to ? `Weekly (${WEEKDAYS[from.getDay()]}\u2013${WEEKDAYS[to.getDay()]})` : "";
  const text2 =
    from && to
      ? `${ddmmyyyy(from)} \u2013 ${ddmmyyyy(to)}`
      : payment
        ? `Paid ${ddmmyyyy(payment)}`
        : "";

  return {
    from: from ? isoDate(from) : null,
    to: to ? isoDate(to) : null,
    fromLabel: from ? longLabel(from) : null,
    toLabel: to ? longLabel(to) : null,
    paymentDate: payment ? isoDate(payment) : null,
    paymentDateLabel: payment ? longLabel(payment) : null,
    cycleLabel,
    text: text2,
  };
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

// Trailing "TYPE" column keyword on a payslip earnings/deductions table row.
const ROW_TYPE_RE = /\b(Wages|Salary|Tax|Deductions?|Superannuation|Entitlements?|Allowances?)\b(?:\s+Expenses?)?\s*$/i;

function mapRowType(word) {
  const w = String(word || "").toLowerCase();
  if (w.startsWith("super")) return "super";
  if (w.startsWith("tax") || w.startsWith("deduction")) return "tax";
  if (w.startsWith("entitle")) return "entitlements";
  if (w.startsWith("allowance")) return "wages";
  return "wages"; // Wages / Salary
}

/** Parse one accumulated payslip row: "DESCRIPTION ... $rate $amount $ytd TYPE". */
function parseIncomeRow(buf) {
  const typeMatch = buf.match(ROW_TYPE_RE);
  if (!typeMatch) return null;
  const body = buf.slice(0, typeMatch.index).trim();

  // Money columns carry a "$" (allow a leading minus for deductions).
  // NOTE: keep $0.00 values (a zero this-period column is meaningful and tells
  // us which column is the period AMOUNT vs the YTD figure).
  const moneyRe = /(-?)\s*\$\s?(-?\d{1,3}(?:,\d{3})*\.\d{2})/g;
  const monies = [];
  let m;
  while ((m = moneyRe.exec(body)) !== null) {
    let value = Number(m[2].replace(/,/g, ""));
    if (Number.isNaN(value)) continue;
    if (m[1] === "-") value = -Math.abs(value);
    monies.push(round2(value));
  }
  if (!monies.length) return null; // accrual/units-only row (no dollar column)

  // Columns are RATE, AMOUNT(period), YTD — so the period amount is 2nd-to-last.
  const amount = monies.length >= 2 ? monies[monies.length - 2] : monies[0];

  // Description = text before the first numeric column (hours or a $ value).
  const cut = body.search(/\s(?:-?\$|\d{1,3}(?:,\d{3})*\.\d{1,2}\b)/);
  let desc = (cut > 0 ? body.slice(0, cut) : body.replace(moneyRe, "")).replace(/\s{2,}/g, " ").trim();
  if (!desc) desc = "Item";
  if (desc.length > 48) desc = desc.slice(0, 48).trim();

  return { description: desc, amount: round2(amount), type: mapRowType(typeMatch[1]) };
}

/**
 * Parse a tabular payslip/remittance: finds the DESCRIPTION/AMOUNT header, then
 * reads each row (joining wrapped lines) into { description, amount, type }.
 */
function parseIncomeTable(text) {
  const lines = String(text || "").split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/description/i.test(lines[i]) && /amount/i.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return [];

  const rows = [];
  let buf = "";
  for (let i = start; i < lines.length && rows.length < 100; i++) {
    const ln = lines[i].trim();
    if (/^--.*--$/.test(ln)) break; // page footer e.g. "-- 1 of 1 --"
    if (!ln) continue;
    buf = buf ? `${buf} ${ln}` : ln;
    if (ROW_TYPE_RE.test(buf)) {
      const row = parseIncomeRow(buf);
      if (row) rows.push(row);
      buf = "";
    }
  }
  return rows;
}

function sumDetectedByType(components, type) {
  return components
    .filter((c) => c.type === type && c.detected)
    .reduce((s, c) => s + Math.abs(c.amount), 0);
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
    const fullText = ocr.rawText || ocr.rawTextPreview || "";

    // 1) Tabular payslip/remittance (DESCRIPTION | ... | AMOUNT | YTD | TYPE).
    const tableRows = parseIncomeTable(fullText);
    if (tableRows.length) {
      const seen = new Set();
      let hasSuper = false;
      let grossFromRows = 0;
      for (const r of tableRows) {
        const key = `${r.description.toLowerCase()}:${r.amount.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        components.push({ type: r.type, label: r.description, amount: r.amount, detected: true });
        if (r.type === "super") hasSuper = true;
        if (r.type === "wages") grossFromRows = round2(grossFromRows + r.amount);
      }
      const grossDoc = num(ocr.grossTotal) || grossFromRows;
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

    // 2) Simple "Label: $amount" lines (one amount per line).
    const docItems = parseLabeledLineItems(fullText);
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

  // Sum across every matching row (payslips have many).
  const gross = round2(num(ocr.grossTotal) || sumDetectedByType(comps, "wages") || num(ocr.amount));
  const superAmt = round2(sumDetectedByType(comps, "super"));
  const superDetected = superAmt > 0;
  const taxAmt = round2(sumDetectedByType(comps, "tax"));
  const net = round2(num(ocr.netPay) || sumDetectedByType(comps, "net"));

  const checks = [];

  // 1. Superannuation Guarantee (SG applies to ordinary time earnings, which may
  //    exclude some allowances — so a moderate shortfall is flagged for review
  //    rather than an outright breach).
  if (gross) {
    const expected = round2(gross * rate);
    if (superDetected) {
      const ratio = expected > 0 ? superAmt / expected : 1;
      if (ratio >= 0.95) {
        checks.push({
          name: "Superannuation Guarantee",
          status: "within_policy",
          message: `Super $${superAmt.toFixed(2)} meets the ${(rate * 100).toFixed(1)}% SG minimum ($${expected.toFixed(2)}).`,
        });
      } else if (ratio >= 0.5) {
        checks.push({
          name: "Superannuation Guarantee",
          status: "review",
          message: `Super $${superAmt.toFixed(2)} is below ${(rate * 100).toFixed(1)}% of gross $${gross.toFixed(2)} ($${expected.toFixed(2)}). SG is on ordinary time earnings, which may exclude allowances — verify.`,
        });
      } else {
        checks.push({
          name: "Superannuation Guarantee",
          status: "breach",
          message: `Super $${superAmt.toFixed(2)} is well below the ${(rate * 100).toFixed(1)}% SG minimum ($${expected.toFixed(2)}) on gross $${gross.toFixed(2)}.`,
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
    if (taxAmt > 0) {
      const r = taxAmt / gross;
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
          message: `PAYG tax withheld ($${taxAmt.toFixed(2)}, ${(r * 100).toFixed(1)}% of gross).`,
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

  // 3. Net reconciliation (net ~= gross - tax; super is paid on top).
  if (gross && net && taxAmt) {
    const expectedNet = round2(gross - taxAmt);
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
    meals: COMBINED_MEALS_CAP,
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
  const result = {
    componentBreakdown: breakdown.components,
    breakdownKind: breakdown.kind,
    compliance,
  };
  if (isIncome) {
    const payPeriod = computePayPeriod(ocr.rawText || ocr.rawTextPreview || "");
    if (payPeriod) result.payPeriod = payPeriod;

    // Separate ATO overnight (LAFHA) allowance line for long-haul drivers.
    const driverType = profile.driverType || "long_haul";
    if (driverType !== "local") {
      const days = daysInPeriod(payPeriod);
      const rate = DAILY_OVERNIGHT_ALLOWANCE;
      const amount = round2(days * rate);
      const meals = TRUCK_DRIVER_MEALS;
      result.componentBreakdown.push({
        type: "overnight_allowance",
        label: `Overnight/Driver Daily Allowance (${days} day${days === 1 ? "" : "s"} \u00d7 $${rate.toFixed(2)})`,
        amount,
        detected: false,
        note: `ATO reasonable daily meal amount for employee truck drivers (TD 2025/4): breakfast $${meals.breakfast.cap.toFixed(2)} + lunch $${meals.lunch.cap.toFixed(2)} + dinner $${meals.dinner.cap.toFixed(2)} = $${rate.toFixed(2)}/day (meals only, excludes accommodation). Claim actual spend up to this amount when you received a travel allowance and travelled away overnight. Shown whether or not the payslip lists a travel allowance.`,
      });
      result.overnightAllowance = { perDay: rate, days, amount };
    }
  }
  return result;
}

module.exports = {
  buildComponentBreakdown,
  parseLabeledLineItems,
  parseIncomeTable,
  computePayPeriod,
  assessIncomeCompliance,
  assessExpenseCompliance,
  analyzeScan,
  sgRate,
  round2,
  DAILY_OVERNIGHT_ALLOWANCE,
};
