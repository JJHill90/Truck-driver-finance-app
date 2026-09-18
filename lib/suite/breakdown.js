/**
 * Scan breakdown + ATO compliance for Go Taxation Suite.
 * Reuses payslip/receipt parsing from document-breakdown, but skips truck-driver
 * LAFHA estimates and grades expenses against general TD travel / PAYG / SG /
 * GST rules for the selected entity type.
 */

const {
  buildComponentBreakdown,
  computePayPeriod,
  assessIncomeCompliance,
} = require("../document-breakdown");
const {
  getCurrentFinancialYear,
  getFinancialYearForDate,
  SUBSTANTIATION,
  getCategoryMeta,
  mealCapsForYear,
  sgRateForYear,
  GST_RATE,
} = require("./ato");
const { normalizeEntityType } = require("./profile");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const STATUS_RANK = { breach: 3, exceeds: 2, review: 1, within_policy: 0 };
const STATUS_LABEL = {
  within_policy: "Within ATO policy",
  review: "Needs review",
  exceeds: "Exceeds ATO limit",
  breach: "Possible compliance breach",
};

function worstStatus(checks) {
  let worst = "within_policy";
  for (const c of checks) {
    if (STATUS_RANK[c.status] > STATUS_RANK[worst]) worst = c.status;
  }
  return worst;
}

function buildSummary(scope, status, checks) {
  if (!checks.length) return `${scope}: no ATO compliance flags detected.`;
  const lead = STATUS_LABEL[status] || status;
  const flagged = checks.filter((c) => c.status !== "within_policy");
  if (!flagged.length) return `${scope}: ${lead}.`;
  return `${scope}: ${lead} — ${flagged.map((c) => c.name).join(", ")}.`;
}

function assessSuiteExpenseCompliance(ocr = {}, financialYear, profile = {}) {
  const fy = financialYear || getCurrentFinancialYear();
  const amount = num(ocr.amount);
  const category = ocr.suggestedCategory || "other_work";
  const checks = [];
  const salary = Number(profile.annualSalary) || 0;
  const meals = mealCapsForYear(fy, salary);

  const mealCaps = {
    meals: meals.mealsDaily,
    meals_breakfast: meals.breakfast,
    meals_lunch: meals.lunch,
    meals_dinner: meals.dinner,
    overtime_meals: meals.overtimeMealCap,
  };

  if (mealCaps[category] != null && amount) {
    const cap = mealCaps[category];
    if (amount > cap) {
      checks.push({
        name: "Reasonable amount (meals / travel)",
        status: "exceeds",
        message: `$${amount.toFixed(2)} exceeds the ATO reasonable amount $${cap.toFixed(2)} (${meals.determination}) — only $${cap.toFixed(2)} is deductible without full substantiation.`,
      });
    } else {
      checks.push({
        name: "Reasonable amount (meals / travel)",
        status: "within_policy",
        message: `$${amount.toFixed(2)} is within the ATO reasonable amount $${cap.toFixed(2)} (${meals.determination}).`,
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

  if (category === "groceries_travel") {
    checks.push({
      name: "Private vs work",
      status: "review",
      message: "Everyday groceries are private. This category is only for food bought while travelling overnight for work.",
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

function assessSuiteIncomeCompliance(ocr, breakdown, fy, profile) {
  const entity = normalizeEntityType(profile.entityType || profile.driverType);
  const base = assessIncomeCompliance(ocr, breakdown, fy);
  const checks = [...(base.checks || [])];

  if (entity === "employee") {
    checks.push({
      name: "PAYG income statement",
      status: "review",
      message: "Confirm this matches your income statement (STP) — gross, PAYG withheld and reportable employer super.",
    });
  }

  if (entity !== "employee") {
    const gst = num(ocr.gstAmount || ocr.gst);
    const gross = num(ocr.grossTotal || ocr.amount);
    if (profile.gstRegistered && gross && !gst) {
      checks.push({
        name: "GST",
        status: "review",
        message: `GST-registered ${entity.replace("_", " ")}: no GST detected. If this sale was taxable, GST is typically ${round2(gross * GST_RATE / (1 + GST_RATE)).toFixed(2)} of a GST-inclusive total.`,
      });
    } else if (profile.gstRegistered && gst) {
      checks.push({
        name: "GST",
        status: "within_policy",
        message: `GST $${gst.toFixed(2)} recorded for this supply — include on your activity statement.`,
      });
    }
    if (entity === "sole_trader") {
      checks.push({
        name: "Business income",
        status: "review",
        message: "Sole trader: include gross fees/sales here and claim business expenses in the Expenses tab. Super Guarantee applies if you have employees.",
      });
    }
    if (entity === "partnership") {
      checks.push({
        name: "Partnership distribution",
        status: "review",
        message: "Record your partnership net-income share (and any partner salary), not the whole firm's takings, unless this document is already your share.",
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

function analyzeScan(ocr = {}, purpose = "expense", profile = {}) {
  const isIncome = purpose === "income" || ocr.documentType === "income";
  const payPeriod = isIncome ? computePayPeriod(ocr.rawText || ocr.rawTextPreview || "") : null;
  const fyFromDoc =
    (payPeriod && payPeriod.to && getFinancialYearForDate(payPeriod.to)) ||
    (ocr.date && getFinancialYearForDate(ocr.date)) ||
    null;
  const fy = fyFromDoc || profile.financialYear || getCurrentFinancialYear();
  const breakdown = buildComponentBreakdown(ocr, isIncome, fy);
  const compliance = isIncome
    ? assessSuiteIncomeCompliance(ocr, breakdown, fy, profile)
    : assessSuiteExpenseCompliance(ocr, fy, profile);

  const result = {
    componentBreakdown: breakdown.components,
    breakdownKind: breakdown.kind,
    compliance,
  };
  if (isIncome && payPeriod) result.payPeriod = payPeriod;

  if (isIncome) {
    const entity = normalizeEntityType(profile.entityType || profile.driverType);
    const rate = sgRateForYear(fy);
    if (entity === "employee") {
      result.componentBreakdown = result.componentBreakdown || [];
      const hasSuper = (result.componentBreakdown || []).some((c) => c.type === "super");
      if (!hasSuper) {
        const gross = num(ocr.grossTotal) || num(ocr.amount);
        if (gross) {
          result.componentBreakdown.push({
            type: "super",
            label: `Employer Super Guarantee (${(rate * 100).toFixed(1)}% estimate)`,
            amount: round2(gross * rate),
            detected: false,
            note: `SG is paid by the employer on ordinary time earnings — it is usually not a deduction on your individual return. Confirm against your income statement.`,
          });
        }
      }
    }
  }

  return result;
}

module.exports = {
  analyzeScan,
  assessSuiteExpenseCompliance,
  assessSuiteIncomeCompliance,
};
