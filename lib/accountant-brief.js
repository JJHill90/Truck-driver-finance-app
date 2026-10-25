/**
 * Entity-aware lodgement brief for the accountant pack (PDF, JSON, share,
 * on-screen EOFY). Builds from profile + ledgers already on file — it is a
 * working paper for a registered tax agent, not a lodged return.
 */

const { getFinancialYearForDate } = require("./ato-standards");

function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function fyOf(date) {
  try {
    return getFinancialYearForDate(date);
  } catch {
    return "";
  }
}

function inFy(row, fy) {
  if (!row || row.deletedAt) return false;
  if (!fy) return true;
  return fyOf(row.date) === fy;
}

function paygFrom(row) {
  const n = Number(row && (row.taxWithheld || row.paygWithheld || row.payg));
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

function assessableFrom(row) {
  const taxable = Number(row && row.taxableIncome);
  if (Number.isFinite(taxable) && taxable > 0) return round2(taxable);
  const gross = Number(row && row.grossTotal);
  if (Number.isFinite(gross) && gross > 0) return round2(gross);
  return round2(row && row.amount);
}

function payerName(row) {
  const name = String((row && (row.vendor || row.entity || row.employer || row.payer)) || "").trim();
  return name || "Unnamed payer";
}

function payerAbn(row) {
  const raw = String((row && (row.vendorAbn || row.abn || row.employerAbn)) || "").replace(/\s/g, "");
  return raw || "";
}

function normalizeEntity(profile = {}, product) {
  if (product !== "suite") return "employee";
  const key = String(profile.entityType || profile.driverType || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "sole_trader" || key === "soletrader" || key === "own_business") return "sole_trader";
  if (key === "partnership" || key === "partner") return "partnership";
  return "employee";
}

const ENTITY_META = {
  employee: {
    label: "Employee (PAYG)",
    returnKind: "individual_iitr",
    returnTitle: "Individual tax return (IITR) — salary and wages",
    purpose:
      "Working paper for an individual return where the main income is salary or wages under PAYG withholding from an established employer.",
  },
  sole_trader: {
    label: "Sole trader",
    returnKind: "individual_sole_trader",
    returnTitle: "Individual tax return — sole trader (business schedule)",
    purpose:
      "Working paper for an individual return that includes business profit (sales minus expenses). Activity statements apply if GST-registered.",
  },
  partnership: {
    label: "Partnership interest",
    returnKind: "partnership_interest",
    returnTitle: "Partnership return + individual item 13 (your share)",
    purpose:
      "Working paper for the partner’s individual return. The partnership itself is not taxed; lodge a partnership return separately, then include this partner’s distribution share.",
  },
};

const INCOME_RETURN_LABELS = {
  salary_wages: { item: "Item 1", label: "Salary or wages" },
  bonus: { item: "Item 1", label: "Salary or wages (bonus / commission)" },
  allowance_taxable: { item: "Item 2", label: "Allowances, earnings, tips" },
  allowance_travel: { item: "Item 2", label: "Allowances (travel)" },
  allowance_overtime_meal: { item: "Item 2", label: "Allowances (overtime meal)" },
  allowance_car: { item: "Item 2", label: "Allowances (car / km)" },
  interest: { item: "Item 10", label: "Gross interest" },
  dividends: { item: "Item 11", label: "Dividends" },
  government_payments: { item: "Item 5", label: "Australian Government payments" },
  business_income: { item: "Business schedule", label: "Business sales / fees (P8-style)" },
  services_income: { item: "Business schedule", label: "Contractor / professional fees" },
  partnership_distribution: { item: "Item 13", label: "Partnership distribution (your share)" },
  partner_salary: { item: "Item 13", label: "Partner salary / guaranteed payment" },
  other_income: { item: "Item 24", label: "Other income" },
  reimbursement: { item: "—", label: "Not assessable (reimbursement)" },
};

function scheduleLabel(code) {
  const map = {
    D1: "D1 Work-related car expenses",
    D2: "D2 Work-related travel expenses",
    D3: "D3 Clothing, laundry and dry-cleaning",
    D4: "D4 Self-education",
    D5: "D5 Other work-related expenses",
    "Item D9": "D9 Gifts or donations",
    D9: "D9 Gifts or donations",
  };
  return map[code] || code || "Other deduction";
}

function buildPayers(income, fy) {
  const groups = new Map();
  for (const row of income.filter((r) => inFy(r, fy))) {
    const name = payerName(row);
    const abn = payerAbn(row);
    const key = `${name}|${abn}|${row.type || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        payer: name,
        abn,
        incomeType: row.type || "",
        count: 0,
        gross: 0,
        assessable: 0,
        paygWithheld: 0,
        firstDate: row.date || "",
        lastDate: row.date || "",
      });
    }
    const g = groups.get(key);
    g.count += 1;
    g.gross = round2(g.gross + (Number(row.grossTotal) || Number(row.amount) || 0));
    g.assessable = round2(g.assessable + assessableFrom(row));
    g.paygWithheld = round2(g.paygWithheld + paygFrom(row));
    if (row.date && (!g.firstDate || row.date < g.firstDate)) g.firstDate = row.date;
    if (row.date && (!g.lastDate || row.date > g.lastDate)) g.lastDate = row.date;
  }
  return [...groups.values()].sort((a, b) => b.assessable - a.assessable);
}

function buildIncomeLabels(summary) {
  return ((summary && summary.income && summary.income.breakdown) || [])
    .filter((b) => Number(b.assessableTotal) > 0 || Number(b.grossTotal) > 0)
    .map((b) => {
      const hint = INCOME_RETURN_LABELS[b.type] || { item: "Review", label: b.label || b.type };
      return {
        type: b.type,
        sourceLabel: b.label,
        returnItem: hint.item,
        returnLabel: hint.label,
        gross: round2(b.grossTotal),
        assessable: round2(b.assessableTotal),
        count: b.count || 0,
      };
    });
}

function buildDeductionLabels(summary) {
  const bySchedule = new Map();
  for (const b of (summary && summary.expenses && summary.expenses.breakdown) || []) {
    const code = b.atoSchedule || "Other";
    if (!bySchedule.has(code)) {
      bySchedule.set(code, {
        schedule: code,
        label: scheduleLabel(code),
        deductible: 0,
        count: 0,
        categories: [],
      });
    }
    const g = bySchedule.get(code);
    g.deductible = round2(g.deductible + (Number(b.deductibleTotal) || 0));
    g.count += Number(b.count) || 0;
    g.categories.push(b.label || b.category);
  }
  return [...bySchedule.values()].sort((a, b) => String(a.schedule).localeCompare(String(b.schedule)));
}

function substantiationRollup(expenses, fy, summary) {
  const rows = expenses.filter((r) => inFy(r, fy));
  let withReceipt = 0;
  let cash = 0;
  for (const row of rows) {
    if (row.receiptId || (Array.isArray(row.receiptIds) && row.receiptIds.length)) withReceipt += 1;
    if (row.cashTransaction || row.cash || row.noReceipt) cash += 1;
  }
  const threshold = (summary && summary.substantiation && summary.substantiation.threshold) || 300;
  const deductible = round2((summary && summary.expenses && summary.expenses.deductibleTotal) || 0);
  return {
    expenseCount: rows.length,
    withLinkedReceipt: withReceipt,
    withoutLinkedReceipt: Math.max(0, rows.length - withReceipt),
    cashOrNoReceiptFlag: cash,
    writtenEvidenceLikelyRequired: deductible > threshold,
    threshold,
    message:
      (summary && summary.substantiation && summary.substantiation.message) ||
      "Keep records for five years from lodgement.",
  };
}

function extraEntityNotes(profile) {
  const extras = Array.isArray(profile.extraEntities) ? profile.extraEntities : [];
  if (!extras.length) return [];
  return extras.map((e) => {
    const name = e.tradingName || e.employer || "Side entity";
    const type = e.entityType === "employee" ? "PAYG employee" : "sole trader";
    return `This login also has a ${type} “${name}”${e.abn ? ` (ABN ${e.abn})` : ""}. Export a second pack while that entity is active so the agent has both returns.`;
  });
}

function identityFromProfile(profile, entity) {
  const share = Number(profile.partnerSharePercent);
  return {
    name: String(profile.name || "").trim() || "Taxpayer",
    occupation: String(profile.occupation || "").trim(),
    employer: String(profile.employer || "").trim(),
    tradingName: String(profile.tradingName || "").trim(),
    partnershipName: String(profile.partnershipName || "").trim(),
    abn: String(profile.abn || "").replace(/\s/g, ""),
    tfnSupplied: Boolean(profile.tfnSupplied),
    gstRegistered: Boolean(profile.gstRegistered),
    partnerSharePercent: Number.isFinite(share) ? share : entity === "partnership" ? 50 : 100,
    annualSalary: round2(profile.annualSalary),
    travelsForWork: Boolean(profile.travelsForWork),
    overnightAllowance: Boolean(profile.overnightAllowance),
  };
}

function gapsFor(entity, identity, payers, summary, substantiation) {
  const gaps = [];
  if (!identity.name || identity.name === "Taxpayer") {
    gaps.push({ code: "name", message: "Legal name is missing on Profile — the agent needs the name used on the TFN." });
  }
  if (!identity.tfnSupplied) {
    gaps.push({
      code: "tfn",
      message: "TFN-with-employer is not ticked. Confirm the TFN is on the income statement / ABN registration before lodgement.",
    });
  }
  if (entity === "employee") {
    if (!identity.employer && !payers.some((p) => p.payer !== "Unnamed payer")) {
      gaps.push({ code: "employer", message: "No employer / payer name on Profile or income rows — needed for item 1." });
    }
    if (!round2(summary && summary.income && summary.income.paygWithheld)) {
      gaps.push({
        code: "payg",
        message: "No PAYG withheld recorded. Ask for the myGov income statement (gross and tax withheld) before lodging.",
      });
    }
  }
  if (entity === "sole_trader") {
    if (!identity.abn) gaps.push({ code: "abn", message: "ABN is blank — required for the business schedule and activity statements." });
    if (!identity.tradingName && !identity.employer) {
      gaps.push({ code: "trading", message: "Trading name is blank — use the name on the ABN lookup." });
    }
    if (identity.gstRegistered && !round2(summary && summary.income && summary.income.gstOnSales) && !round2(summary && summary.expenses && summary.expenses.gstOnPurchases)) {
      gaps.push({
        code: "gst_amounts",
        message: "GST-registered, but no GST amounts sit on income or expenses. Confirm tax invoices before completing the BAS worksheet.",
      });
    }
    const hasBiz = ((summary && summary.income && summary.income.breakdown) || []).some(
      (b) => b.type === "business_income" || b.type === "services_income"
    );
    if (!hasBiz) {
      gaps.push({
        code: "business_income",
        message: "No business sales / contractor fees recorded. The sole-trader schedule will look empty without invoices.",
      });
    }
  }
  if (entity === "partnership") {
    if (!identity.partnershipName) {
      gaps.push({ code: "partnership_name", message: "Partnership name is blank — needed for the partnership return header." });
    }
    if (!identity.abn) {
      gaps.push({ code: "abn", message: "Partnership ABN is blank." });
    }
    if (!(identity.partnerSharePercent > 0 && identity.partnerSharePercent <= 100)) {
      gaps.push({ code: "share", message: "Partner share % is missing or out of range — item 13 needs the profit-sharing ratio." });
    }
    const hasDist = ((summary && summary.income && summary.income.breakdown) || []).some(
      (b) => b.type === "partnership_distribution" || b.type === "partner_salary"
    );
    if (!hasDist) {
      gaps.push({
        code: "distribution",
        message: "No partnership distribution or partner salary recorded. The agent still needs the partnership P&L allocation.",
      });
    }
  }
  if (substantiation.writtenEvidenceLikelyRequired && substantiation.withoutLinkedReceipt > 0) {
    gaps.push({
      code: "receipts",
      message: `Work deductions exceed $${substantiation.threshold} and ${substantiation.withoutLinkedReceipt} expense row(s) have no linked receipt.`,
    });
  }
  return gaps;
}

function questionsFor(entity, identity) {
  const common = [
    "Confirm residency, spouse/dependants and private health insurance (Medicare levy surcharge).",
    "Ask whether HELP/HECS, SFSS or other study/trade debts should reduce the refund.",
    "Match this pack to myGov income statements, bank interest and dividend statements not scanned into the app.",
  ];
  if (entity === "employee") {
    return [
      "Does the employer’s STP income statement match item 1 gross and PAYG withheld in this pack?",
      "Were any allowances on the income statement already included, or paid in cash off-statement?",
      identity.travelsForWork
        ? "Travel / overnight allowance: is there a travel diary or work diary for nights away?"
        : "Any work-related travel, home office or car claims not yet entered?",
      ...common,
    ];
  }
  if (entity === "sole_trader") {
    return [
      "Cash or accruals accounting method for the business?",
      "Personal services income (PSI) rules — does the work look like an employee in disguise?",
      "Motor vehicle: cents per km or logbook? Home office: fixed rate or actual cost?",
      identity.gstRegistered
        ? "Reconcile this pack’s GST boxes to lodged (or draft) activity statements."
        : "Turnover approaching $75,000 GST registration threshold?",
      "Personal super contributions — notice of intent lodged with the fund?",
      ...common,
    ];
  }
  return [
    "Has a separate partnership tax return been prepared for the same FY?",
    `Confirm the profit-sharing ratio (profile currently ${identity.partnerSharePercent}%).`,
    "Are there other partners who need a copy of the partnership P&L?",
    identity.gstRegistered
      ? "GST is registered at partnership level — use the BAS worksheet for the partnership ABN, not the partner’s TFN."
      : "Is the partnership GST-registered under a different ABN?",
    ...common,
  ];
}

function taxPosition(summary) {
  const tax = (summary && summary.taxEstimate) || {};
  const withheld = round2((summary && summary.income && summary.income.paygWithheld) || tax.paygWithheld);
  const estimated = round2(tax.totalTax);
  const payable = round2(tax.taxPayable != null ? tax.taxPayable : estimated - withheld);
  return {
    taxableIncome: round2(tax.taxableIncome),
    incomeTax: round2(tax.incomeTaxAfterOffsets != null ? tax.incomeTaxAfterOffsets : tax.incomeTax),
    lito: round2(tax.lito),
    medicareLevy: round2(tax.medicareLevy),
    estimatedTax: estimated,
    paygWithheld: withheld,
    refundOrPayable: payable,
    outcome: payable < 0 ? "estimated_refund" : payable > 0 ? "estimated_payable" : "balanced",
    outcomeLabel:
      payable < 0
        ? `Estimated refund ${formatMoney(Math.abs(payable))} (withheld exceeds tax)`
        : payable > 0
          ? `Estimated amount payable ${formatMoney(payable)}`
          : "Withholding matches the estimate",
  };
}

function formatMoney(n) {
  const v = round2(n);
  const s = Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-$" : "$") + s;
}

function entitySpecific(entity, identity, summary, payers) {
  if (entity === "employee") {
    return {
      heading: "PAYG salary — what the agent needs",
      points: [
        "Item 1: salary and wages from each payer below (gross, not net pay).",
        "Label T / PAYG withheld: total tax withheld on income statements.",
        "Item 2: allowances only where they are assessable (usually if shown on the statement, or if a related deduction is claimed).",
        "D1–D5: work-related deductions with a sufficient connection to this job.",
        "Super Guarantee is generally the employer’s cost — not a deduction on this return unless the taxpayer made a personal contribution.",
      ],
      paygEmployers: payers.filter((p) => p.paygWithheld > 0 || /salary|wage|bonus|allowance/i.test(p.incomeType)),
    };
  }
  if (entity === "sole_trader") {
    const gst = summary && summary.bas;
    return {
      heading: "Sole trader — what the agent needs",
      points: [
        `Trading name: ${identity.tradingName || identity.employer || "—"} · ABN ${identity.abn || "not on file"}.`,
        identity.gstRegistered
          ? "GST registered — complete activity statements (see BAS worksheet) as well as the individual return."
          : "Not marked GST-registered. Confirm turnover against the $75,000 threshold.",
        "Business income (invoices / fees) minus business expenses = profit taxed at individual resident rates.",
        "If this person also has a PAYG job, keep salary (item 1) separate from business sales.",
        "Instant asset write-off may apply to eligible depreciating assets — check the year threshold on the tax estimate notes.",
      ],
      gstSnapshot: gst
        ? {
            gstOnSales: round2(gst.gstOnSales),
            gstOnPurchases: round2(gst.gstOnPurchases),
            netGst: round2(gst.netGst),
            note: gst.note,
          }
        : null,
    };
  }
  return {
    heading: "Partnership interest — what the agent needs",
    points: [
      `Partnership: ${identity.partnershipName || "unnamed"} · ABN ${identity.abn || "not on file"}.`,
      `This partner’s share: ${identity.partnerSharePercent}%.`,
      "Lodge the partnership return first. Then include this partner’s distribution (item 13) and any partner salary on the individual return.",
      "Partner-level deductions (e.g. interest on money borrowed to fund the interest) sit on the individual return, not the partnership P&L.",
      identity.gstRegistered
        ? "GST is flagged — activity statements are usually in the partnership ABN."
        : "GST is not flagged on this profile.",
    ],
    partnerSharePercent: identity.partnerSharePercent,
  };
}

function buildLodgementBrief(records = {}, profile = {}, summary = {}, opts = {}) {
  const product = opts.product === "suite" ? "suite" : "haulage";
  const entity = normalizeEntity(profile, product);
  const meta = ENTITY_META[entity];
  const fy = (summary && summary.financialYear) || profile.financialYear || "";
  const identity = identityFromProfile(profile, entity);
  const payers = buildPayers(records.income || [], fy);
  const incomeLabels = buildIncomeLabels(summary);
  const deductionLabels = buildDeductionLabels(summary);
  const substantiation = substantiationRollup(records.expenses || [], fy, summary);
  const position = taxPosition(summary);
  const extras = extraEntityNotes(profile);
  const gaps = gapsFor(entity, identity, payers, summary, substantiation);
  const questions = questionsFor(entity, identity);

  return {
    entityType: entity,
    entityLabel: meta.label,
    product,
    financialYear: fy,
    returnKind: meta.returnKind,
    returnTitle: meta.returnTitle,
    purpose: meta.purpose,
    identity,
    payers,
    incomeLabels,
    deductionLabels,
    taxPosition: position,
    substantiation,
    gaps,
    questions,
    extraEntities: extras,
    entitySpecific: entitySpecific(entity, identity, summary, payers),
    includeTravelCaps: Boolean(summary && summary.allowances && summary.allowances.enabled),
    disclaimer:
      "Prepared for a registered tax agent. Not a lodged return and not tax advice. Confirm against myGov, activity statements and current ATO guidance.",
  };
}

function attachLodgementBrief(report, records, profile, opts = {}) {
  if (!report || typeof report !== "object") return report;
  report.lodgementBrief = buildLodgementBrief(records, profile, report.summary || {}, opts);
  return report;
}

module.exports = {
  normalizeEntity,
  buildLodgementBrief,
  attachLodgementBrief,
  INCOME_RETURN_LABELS,
};
