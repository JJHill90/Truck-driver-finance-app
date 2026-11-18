/**
 * Official individual-return labels for Forecast and the EOFY working paper.
 *
 * Category ids stay as the app stored them. What the driver and their agent
 * see on the report, the PDF, and Forecast is one label per return box:
 * item 1, 2, 5, 10, 11, 13, 15 / the business schedule, and 24 for income;
 * D1–D5, D9, D10, D12 and D15 for deductions. Sole-trader and partnership
 * operating costs use the business-schedule expense lines.
 *
 * This is a working paper. It does not lodge a return.
 */
const DEDUCTIONS = {
  D1: "D1 Work-related car expenses",
  D2: "D2 Work-related travel expenses",
  D3: "D3 Work-related clothing, laundry and dry-cleaning expenses",
  D4: "D4 Work-related self-education expenses",
  D5: "D5 Other work-related expenses",
  D9: "D9 Gifts or donations",
  D10: "D10 Cost of managing tax affairs",
  D12: "D12 Personal superannuation contributions",
  D15: "D15 Other deductions",
};

const BUSINESS = {
  stock_cogs: "Business schedule — purchases and other costs",
  contractor_payments: "Business schedule — contractor, sub-contractor and commission expenses",
  rent_occupancy: "Business schedule — rent expenses",
  advertising: "Business schedule — all other expenses",
  insurance_business: "Business schedule — all other expenses",
  bank_fees: "Business schedule — all other expenses",
  professional_fees: "Business schedule — all other expenses",
  utilities_business: "Business schedule — all other expenses",
};

const ALL_OTHER = "Business schedule — all other expenses";
const DEPRECIATION = "Business schedule — depreciation expenses";

/** Overnight travel (including truck-driver meals). Overtime meals stay D5. */
const TRAVEL_D2 = new Set([
  "accommodation",
  "groceries_travel",
  "snacks_drinks",
  "incidentals",
  "rest_facilities",
  "travel_general",
  "meals",
  "meals_breakfast",
  "meals_lunch",
  "meals_dinner",
]);

const INCOME = {
  salary_wages: { item: "1", label: "Item 1 Salary or wages" },
  bonus: { item: "1", label: "Item 1 Salary or wages" },
  allowance_taxable: {
    item: "2",
    label: "Item 2 Allowances, earnings, tips, directors fees etc.",
  },
  allowance_travel: {
    item: "2",
    label: "Item 2 Allowances, earnings, tips, directors fees etc.",
  },
  allowance_overtime_meal: {
    item: "2",
    label: "Item 2 Allowances, earnings, tips, directors fees etc.",
  },
  allowance_car: {
    item: "2",
    label: "Item 2 Allowances, earnings, tips, directors fees etc.",
  },
  compensation: {
    item: "2",
    label: "Item 2 Allowances, earnings, tips, directors fees etc.",
  },
  training_allowance: {
    item: "2",
    label: "Item 2 Allowances, earnings, tips, directors fees etc.",
  },
  government_payments: {
    item: "5",
    label: "Item 5 Australian Government allowances and payments",
  },
  interest: { item: "10", label: "Item 10 Gross interest" },
  dividends: { item: "11", label: "Item 11 Dividends" },
  partnership_distribution: { item: "13", label: "Item 13 Partnerships and trusts" },
  partner_salary: { item: "13", label: "Item 13 Partnerships and trusts" },
  remittance_owner: {
    item: "P8 / 15",
    label: "Item 15 Business schedule — gross income (item 15 on the return is the net)",
  },
  business_income: {
    item: "P8 / 15",
    label: "Item 15 Business schedule — gross income (item 15 on the return is the net)",
  },
  services_income: {
    item: "P8 / 15",
    label: "Item 15 Business schedule — gross income (item 15 on the return is the net)",
  },
  other_income: { item: "24", label: "Item 24 Other income" },
  reimbursement: { item: "—", label: "Not included — reimbursement" },
};

const WORKING_PAPER_NOTE =
  "Working paper for a tax agent. Labels match the individual tax return. This app does not lodge a return.";

function box(code) {
  return { code, label: DEDUCTIONS[code] };
}

function businessBox(label) {
  return { code: "P8", label };
}

function isBusinessEntity(entity) {
  return entity === "sole_trader" || entity === "partnership";
}

function entityFromProfile(profile = {}, product = "haulage") {
  if (product === "suite") {
    const id = String(profile.entityType || profile.driverType || "employee");
    if (isBusinessEntity(id)) return id;
    return "employee";
  }
  if (String(profile.driverType || "") === "owner_driver") return "sole_trader";
  return "employee";
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * One deduction label for a stored category.
 * @param {string} categoryId
 * @param {string} rawSchedule value stored on the category (may be informal)
 * @param {{ product?: string, entity?: string }} [opts]
 */
function mapExpenseSchedule(categoryId, rawSchedule, opts = {}) {
  const id = String(categoryId || "");
  const raw = String(rawSchedule || "");
  const suite = opts.product === "suite";
  const business = isBusinessEntity(opts.entity);

  if (id === "income_protection") return box("D15");
  if (id === "super_personal" || /^personal superannuation/i.test(raw)) return box("D12");
  if (id === "donations_dgr" || /^D9\b/i.test(raw)) return box("D9");
  if (id === "tax_affairs" || /^D10\b/i.test(raw)) return box("D10");
  if (id === "parking_tolls" || raw === "D1 or D2") return box("D1");
  if (TRAVEL_D2.has(id)) return box("D2");
  if (BUSINESS[id]) return businessBox(BUSINESS[id]);
  if ((id === "home_office_hours" || id === "home_office_actual") && suite && business) {
    return businessBox(ALL_OTHER);
  }
  if (id === "cleaning_supplies" && suite && business) return businessBox(ALL_OTHER);
  if (/instant asset|decline in value|depreciat/i.test(raw)) return businessBox(DEPRECIATION);
  if (/^D1\b/i.test(raw)) return box("D1");
  if (/^D2\b/i.test(raw)) return box("D2");
  if (/^D3\b/i.test(raw)) return box("D3");
  if (/^D4\b/i.test(raw)) return box("D4");
  if (/^D5\b/i.test(raw)) return box("D5");
  if (/business deduction/i.test(raw)) return businessBox(ALL_OTHER);
  if (/superannuation/i.test(raw)) return box("D12");
  return box("D5");
}

function mapIncomeItem(typeId) {
  return (
    INCOME[String(typeId || "")] || {
      item: "24",
      label: "Item 24 Other income",
    }
  );
}

/** Rewrite a year summary in place so report tables show the official labels. */
function applyAtoReturnLabels(summary, opts = {}) {
  if (!summary) return summary;
  const expenses = (summary.expenses && summary.expenses.breakdown) || [];
  for (const row of expenses) {
    if (!row.sourceSchedule) row.sourceSchedule = row.atoSchedule || "";
    const mapped = mapExpenseSchedule(row.category, row.sourceSchedule, opts);
    row.atoCode = mapped.code;
    row.atoSchedule = mapped.label;
  }
  const income = (summary.income && summary.income.breakdown) || [];
  for (const row of income) {
    if (!row.sourceLabel) row.sourceLabel = row.label || row.type || "";
    const mapped = mapIncomeItem(row.type);
    row.atoItem = mapped.item;
    row.returnLabel = mapped.label;
    row.label = mapped.label;
  }
  return summary;
}

/** Year-to-date totals rolled up to one row per return label. */
function rollupAtoReturn(summary) {
  const income = new Map();
  for (const row of (summary && summary.income && summary.income.breakdown) || []) {
    const label = row.returnLabel || row.label || "Item 24 Other income";
    const prev = income.get(label) || {
      label,
      item: row.atoItem || "",
      gross: 0,
      assessable: 0,
    };
    prev.gross = round2(prev.gross + row.grossTotal);
    prev.assessable = round2(prev.assessable + row.assessableTotal);
    income.set(label, prev);
  }
  const deductions = new Map();
  for (const row of (summary && summary.expenses && summary.expenses.breakdown) || []) {
    const label = row.atoSchedule || DEDUCTIONS.D5;
    const prev = deductions.get(label) || {
      label,
      code: row.atoCode || "",
      deductible: 0,
      count: 0,
    };
    prev.deductible = round2(prev.deductible + row.deductibleTotal);
    prev.count += Number(row.count) || 0;
    deductions.set(label, prev);
  }
  return {
    note: WORKING_PAPER_NOTE,
    income: [...income.values()],
    deductions: [...deductions.values()],
  };
}

function scheduleMapping(summary) {
  return ((summary && summary.expenses && summary.expenses.breakdown) || []).map((b) => ({
    schedule: b.atoSchedule,
    code: b.atoCode || "",
    category: b.sourceLabel || b.label,
    deductibleAmount: b.deductibleTotal,
    transactionCount: b.count,
  }));
}

/**
 * Stamp official labels onto a report, then rebuild the schedule mapping.
 * Safe to call once, after the year summary is final.
 */
function stampReport(report, profile, product) {
  if (!report || !report.summary) return report;
  const opts = { product, entity: entityFromProfile(profile, product) };
  applyAtoReturnLabels(report.summary, opts);
  report.atoReturn = rollupAtoReturn(report.summary);
  report.atoScheduleMapping = scheduleMapping(report.summary);
  return report;
}

module.exports = {
  DEDUCTIONS,
  WORKING_PAPER_NOTE,
  mapExpenseSchedule,
  mapIncomeItem,
  applyAtoReturnLabels,
  rollupAtoReturn,
  scheduleMapping,
  stampReport,
  entityFromProfile,
};
