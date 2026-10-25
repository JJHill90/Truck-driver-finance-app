/**
 * Pro+ taxpayer briefing for a registered tax agent.
 *
 * Builds a registration-aware working paper from the saved profile and
 * ledgers: PAYG employee, sole trader, or partnership (Suite), plus Hub
 * owner-driver treated as a contractor/sole trader. Maps income to
 * individual-return labels and lists what the agent still needs.
 *
 * Not a lodged return and not tax advice.
 */
const { getFinancialYearForDate, INCOME_TYPES: HUB_INCOME } = require("./ato-standards");
const hubAto = require("./ato-standards");
const suiteAto = require("./suite/ato");
const { normalizeEntityType, ENTITY_TYPES } = require("./suite/profile");
const { driverTypeLabel } = require("./driver-role-defaults");
const { payslipTaxVisualFromRecords } = require("./income-tax-withheld");
const { summariseOvernightDays } = require("./overnight-days");
const { presentExpenseLabel, presentIncomeTypeLabel, assessableIncomeAmount } = require("./report-present");
const { withActiveLedger } = require("./ledger-lifecycle");
const { normalizeCars, primaryActiveWorkUsePercent } = require("./profile-cars");
const extraEntity = require("./suite/extra-entity");

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

function moneyNum(n) {
  return round2(n);
}

function truthy(v) {
  return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

function fyOf(entry, fy) {
  if (!fy) return true;
  return getFinancialYearForDate(entry && entry.date) === fy;
}

function categoryMeta(categoryId, product) {
  const id = String(categoryId || "");
  if (product === "suite") return suiteAto.getCategoryMeta(id) || hubAto.getCategoryMeta(id);
  return hubAto.getCategoryMeta(id) || suiteAto.getCategoryMeta(id);
}

function incomeMeta(typeId, product) {
  const id = String(typeId || "");
  if (product === "suite") return suiteAto.INCOME_TYPES[id] || HUB_INCOME[id] || null;
  return HUB_INCOME[id] || suiteAto.INCOME_TYPES[id] || null;
}

/**
 * Hub truck profiles are PAYG employees unless owner-driver (ABN contractor).
 * Suite uses entityType: employee | sole_trader | partnership.
 */
function resolveRegistration(profile = {}, product = "haulage") {
  if (product === "suite") {
    const id = normalizeEntityType(profile.entityType || profile.driverType);
    const meta = ENTITY_TYPES[id] || ENTITY_TYPES.employee;
    return {
      id,
      label: meta.label,
      description: meta.description,
      notes: meta.notes,
      source: "entityType",
    };
  }
  const driver = String(profile.driverType || "").trim() || "long_haul";
  if (driver === "owner_driver") {
    return {
      id: "sole_trader",
      label: "Owner-driver / contractor (ABN)",
      description: "Gross remittances before expenses — treated like a sole trader for the briefing.",
      notes: ENTITY_TYPES.sole_trader.notes,
      source: "owner_driver",
      driverType: driver,
      driverTypeLabel: driverTypeLabel(driver),
    };
  }
  return {
    id: "employee",
    label: "Employee (PAYG)",
    description: "Salary or wages from an employer under pay-as-you-go withholding.",
    notes: ENTITY_TYPES.employee.notes,
    source: "driverType",
    driverType: driver,
    driverTypeLabel: driverTypeLabel(driver),
  };
}

const IITR_INCOME = {
  salary_wages: { item: "1", label: "Salary or wages" },
  remittance_owner: { item: "P8 / 15", label: "Business / contractor payments" },
  bonus: { item: "1", label: "Salary or wages (bonus / commission)" },
  allowance_taxable: { item: "2", label: "Allowances, earnings, tips, directors fees" },
  allowance_travel: { item: "2", label: "Travel allowance" },
  allowance_overtime_meal: { item: "2", label: "Overtime meal allowance" },
  allowance_car: { item: "2", label: "Car / kilometre allowance" },
  compensation: { item: "2", label: "Other employment allowance" },
  interest: { item: "10", label: "Gross interest" },
  dividends: { item: "11", label: "Dividends" },
  government_payments: { item: "5", label: "Australian Government payments" },
  business_income: { item: "P8 / 15", label: "Net business income (gross sales)" },
  services_income: { item: "P8 / 15", label: "Professional / contractor fees" },
  partnership_distribution: { item: "13", label: "Partnership distribution" },
  partner_salary: { item: "13", label: "Partner salary / guaranteed payment" },
  reimbursement: { item: "—", label: "Reimbursement (not assessable)" },
  other_income: { item: "24", label: "Other income" },
};

function mapIncomeItem(typeId) {
  return IITR_INCOME[String(typeId || "")] || { item: "24", label: "Other income" };
}

function deductionBucket(categoryId, product) {
  const meta = categoryMeta(categoryId, product) || {};
  const schedule = String(meta.atoSchedule || "");
  if (/^D1\b/i.test(schedule) || /car expenses/i.test(schedule)) return { id: "D1", label: "D1 Work-related car expenses" };
  if (/^D2\b/i.test(schedule) || /travel/i.test(schedule)) return { id: "D2", label: "D2 Work-related travel expenses" };
  if (/^D3\b/i.test(schedule) || /clothing|laundry/i.test(schedule)) {
    return { id: "D3", label: "D3 Clothing, laundry and dry-cleaning" };
  }
  if (/^D4\b/i.test(schedule) || /self-education|self education/i.test(schedule)) {
    return { id: "D4", label: "D4 Self-education expenses" };
  }
  if (/donat|gift/i.test(schedule) || /donat|gift/i.test(categoryId)) {
    return { id: "D9", label: "D9 Gifts or donations" };
  }
  if (/tax.?agent|tax.?affair/i.test(schedule) || /tax_agent|tax-agent/i.test(categoryId)) {
    return { id: "D10", label: "D10 Cost of managing tax affairs" };
  }
  if (/super/i.test(schedule) || /super/i.test(categoryId)) {
    return { id: "D12", label: "Personal superannuation contributions" };
  }
  if (/home.?office|pcg 2023/i.test(schedule) || /home_office/i.test(categoryId)) {
    return { id: "D5", label: "D5 Other work-related (home office)" };
  }
  if (/instant asset|decline in value|depreciat/i.test(schedule)) {
    return { id: "P8", label: "Business decline in value / instant asset write-off" };
  }
  if (/^D5\b/i.test(schedule)) return { id: "D5", label: "D5 Other work-related expenses" };
  if (product === "suite") return { id: "P8", label: "Business expenses (P8)" };
  return { id: "D5", label: "D5 Other work-related expenses" };
}

function payerName(entry, identity) {
  const named = String(
    (entry && (entry.payer || entry.entity || entry.vendor || entry.employer)) || ""
  ).trim();
  if (named) return named;
  if (identity && identity.employer) return String(identity.employer).trim();
  return "—";
}

function buildIdentity(profile, registration, product) {
  const gst = truthy(profile.gstRegistered);
  const cars = normalizeCars(profile && profile.cars);
  const activeCar = cars.find((c) => c.active) || cars[0] || null;
  const extras = extraEntity.normalizeExtraEntities(profile.extraEntities);
  const identity = {
    name: String(profile.name || "").trim(),
    occupation: String(profile.occupation || "").trim(),
    employer: String(profile.employer || "").trim(),
    tradingName: String(profile.tradingName || "").trim(),
    partnershipName: String(profile.partnershipName || "").trim(),
    partnerSharePercent: num(profile.partnerSharePercent) || (registration.id === "partnership" ? 50 : 100),
    abn: String(profile.abn || "").replace(/\s/g, ""),
    gstRegistered: gst,
    tfnSupplied: truthy(profile.tfnSupplied),
    annualSalary: moneyNum(profile.annualSalary),
    financialYear: String(profile.financialYear || "").trim(),
    travelsForWork: truthy(profile.travelsForWork),
    overnightAllowance: truthy(profile.overnightAllowance),
    licenceClass: product === "suite" ? "" : String(profile.licenceClass || "").trim(),
    workVehicle: product === "suite" ? "" : String(profile.workCombination || profile.vehicleType || "").trim(),
    cars: cars.map((c) => ({
      make: c.make || "",
      model: c.model || "",
      registration: c.registration || "",
      engineSize: c.engineSize || "",
      odometerReading: c.odometerReading || "",
      workUsePercent: c.estimatedWorkUsePercent,
      active: Boolean(c.active),
    })),
    activeCarWorkUsePercent: activeCar ? primaryActiveWorkUsePercent(cars) : null,
    extraEntities: extras.map((e) => ({
      entityType: e.entityType,
      tradingName: e.tradingName,
      abn: e.abn,
      gstRegistered: e.gstRegistered,
      occupation: e.occupation,
    })),
  };
  return identity;
}

function firstDefinedMoney(...values) {
  for (const v of values) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return moneyNum(n);
  }
  return 0;
}

function buildIncomeSchedules(income, fy, product, registration, identity) {
  const byItem = new Map();
  const byPayer = new Map();
  let assessable = 0;
  let gross = 0;
  let reimbursements = 0;
  for (const row of income || []) {
    if (!row || !fyOf(row, fy)) continue;
    const type = String(row.type || row.incomeType || "other_income");
    const meta = incomeMeta(type, product);
    const item = mapIncomeItem(type);
    const g = moneyNum(row.grossTotal > 0 ? row.grossTotal : row.amount);
    const a = assessableIncomeAmount(row);
    const assessableHere = meta && meta.assessable === false ? 0 : a;
    if (type === "reimbursement") reimbursements = moneyNum(reimbursements + g);
    assessable = moneyNum(assessable + assessableHere);
    gross = moneyNum(gross + g);
    const key = `${item.item}|${item.label}`;
    if (!byItem.has(key)) {
      byItem.set(key, {
        item: item.item,
        label: item.label,
        types: [],
        count: 0,
        grossTotal: 0,
        assessableTotal: 0,
      });
    }
    const bucket = byItem.get(key);
    bucket.count += 1;
    bucket.grossTotal = moneyNum(bucket.grossTotal + g);
    bucket.assessableTotal = moneyNum(bucket.assessableTotal + assessableHere);
    if (!bucket.types.includes(presentIncomeTypeLabel(type))) {
      bucket.types.push(presentIncomeTypeLabel(type));
    }
    const payer = payerName(row, identity);
    if (!byPayer.has(payer)) {
      byPayer.set(payer, { payer, count: 0, grossTotal: 0, assessableTotal: 0, paygWithheld: 0 });
    }
    const pay = byPayer.get(payer);
    pay.count += 1;
    pay.grossTotal = moneyNum(pay.grossTotal + g);
    pay.assessableTotal = moneyNum(pay.assessableTotal + assessableHere);
    pay.paygWithheld = moneyNum(pay.paygWithheld + num(row.taxWithheld || row.paygWithheld));
  }
  const items = [...byItem.values()].sort((a, b) => String(a.item).localeCompare(String(b.item)));
  const payers = [...byPayer.values()].sort((a, b) => b.assessableTotal - a.assessableTotal);
  return {
    registrationId: registration.id,
    items,
    payers,
    grossTotal: gross,
    assessableTotal: assessable,
    reimbursements,
    note:
      registration.id === "partnership"
        ? "Item 13 is your share of partnership net income (plus any partner salary). Confirm the partnership distribution statement."
        : registration.id === "sole_trader"
          ? "Business sales sit at P8 / item 15. If GST-registered, confirm GST-exclusive amounts against BAS."
          : "Item 1 and item 2 should match the ATO income statement (PAYG). Allowances not on the statement are included only when a related deduction is claimed.",
  };
}

function buildDeductionSchedules(expenses, fy, product, registration) {
  const bySchedule = new Map();
  const byCategory = new Map();
  let deductible = 0;
  let gross = 0;
  let noReceipt = 0;
  for (const row of expenses || []) {
    if (!row || !fyOf(row, fy)) continue;
    const cat = String(row.category || "other_work");
    const bucket = deductionBucket(cat, product);
    const amount = moneyNum(row.amount);
    const ded = moneyNum(row.deductibleAmount != null ? row.deductibleAmount : amount);
    deductible = moneyNum(deductible + ded);
    gross = moneyNum(gross + amount);
    if (row.noReceipt) noReceipt += 1;
    if (!bySchedule.has(bucket.id)) {
      bySchedule.set(bucket.id, { id: bucket.id, label: bucket.label, count: 0, deductibleTotal: 0, amountTotal: 0 });
    }
    const sch = bySchedule.get(bucket.id);
    sch.count += 1;
    sch.deductibleTotal = moneyNum(sch.deductibleTotal + ded);
    sch.amountTotal = moneyNum(sch.amountTotal + amount);
    if (!byCategory.has(cat)) {
      const meta = categoryMeta(cat, product) || {};
      byCategory.set(cat, {
        category: cat,
        label: presentExpenseLabel(cat),
        atoSchedule: meta.atoSchedule || bucket.label,
        count: 0,
        amountTotal: 0,
        deductibleTotal: 0,
      });
    }
    const c = byCategory.get(cat);
    c.count += 1;
    c.amountTotal = moneyNum(c.amountTotal + amount);
    c.deductibleTotal = moneyNum(c.deductibleTotal + ded);
  }
  const order = ["D1", "D2", "D3", "D4", "D5", "D9", "D10", "D12", "P8"];
  const schedules = [...bySchedule.values()].sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id) || a.id.localeCompare(b.id)
  );
  return {
    registrationId: registration.id,
    schedules,
    categories: [...byCategory.values()].sort((a, b) => b.deductibleTotal - a.deductibleTotal),
    deductibleTotal: deductible,
    amountTotal: gross,
    noReceiptCount: noReceipt,
    note:
      registration.id === "employee"
        ? "D1–D5 are the usual employee work-related labels. Only the work-related portion is shown."
        : registration.id === "partnership"
          ? "Partnership-level expenses stay on the partnership return. Partner-level deductions (D1–D5, D10) sit on the individual return."
          : "Business expenses feed P8 net business income. Keep invoices and an asset register for write-offs.",
  };
}

function checklistItem(id, label, status, detail) {
  return { id, label, status, detail: detail || "" };
}

function buildChecklist(identity, registration, income, deductions, payg, travel) {
  const items = [];
  const have = (v) => Boolean(v && String(v).trim() && v !== "—");

  items.push(
    checklistItem(
      "name",
      "Legal name matches myGov / ID",
      have(identity.name) ? "have" : "missing",
      identity.name || "Add the taxpayer’s legal name on Profile."
    )
  );
  items.push(
    checklistItem(
      "occupation",
      "Occupation on the return",
      have(identity.occupation) || have(registration.driverTypeLabel) ? "have" : "missing",
      identity.occupation || registration.driverTypeLabel || "Set occupation (or driver type) on Profile."
    )
  );
  items.push(
    checklistItem(
      "tfn",
      "TFN with employer / ATO",
      identity.tfnSupplied ? "have" : "unknown",
      identity.tfnSupplied
        ? "TFN is not stored here. Profile says it is with the employer — confirm on the income statement."
        : "TFN is not stored here. Agent needs the TFN from the client or myGov."
    )
  );

  if (registration.id === "employee") {
    items.push(
      checklistItem(
        "employer",
        "PAYG employer / payer",
        have(identity.employer) || income.payers.some((p) => p.payer !== "—") ? "have" : "missing",
        identity.employer || (income.payers[0] && income.payers[0].payer) || "Add employer on Profile."
      )
    );
    items.push(
      checklistItem(
        "income_statement",
        "ATO income statement (salary, allowances, PAYG withheld)",
        payg.withheld > 0 || income.assessableTotal > 0 ? "have" : "missing",
        payg.withheld > 0
          ? `App has ${income.payers.length} payer(s) and PAYG withheld. Confirm against the ATO income statement before lodge.`
          : "No PAYG withheld on saved payslips — client should export the income statement from myGov."
      )
    );
  }

  if (registration.id === "sole_trader") {
    items.push(
      checklistItem(
        "abn",
        "ABN / trading name",
        have(identity.abn) || have(identity.tradingName) || have(identity.employer) ? "have" : "missing",
        [identity.tradingName || identity.employer, identity.abn].filter(Boolean).join(" · ") ||
          "Add ABN and trading name on Profile."
      )
    );
    items.push(
      checklistItem(
        "gst",
        "GST registration and BAS",
        identity.gstRegistered ? "have" : "unknown",
        identity.gstRegistered
          ? "GST-registered — include the BAS worksheet and confirm cash vs accruals."
          : "Not marked GST-registered. Confirm ABN lookup and any voluntary GST."
      )
    );
    items.push(
      checklistItem(
        "invoices",
        "Sales invoices and supplier bills",
        income.assessableTotal > 0 || deductions.deductibleTotal > 0 ? "have" : "missing",
        "Working paper lists category totals. Agent still needs source invoices for material claims."
      )
    );
  }

  if (registration.id === "partnership") {
    items.push(
      checklistItem(
        "partnership",
        "Partnership name and your share %",
        have(identity.partnershipName) ? "have" : "missing",
        identity.partnershipName
          ? `${identity.partnershipName} — ${identity.partnerSharePercent}%`
          : "Add the partnership name and your distribution share on Profile."
      )
    );
    items.push(
      checklistItem(
        "distribution",
        "Partnership distribution statement",
        income.items.some((i) => i.item === "13") ? "have" : "missing",
        "Item 13 should match the partnership return distribution, not just bank transfers."
      )
    );
  }

  const carClaim = deductions.schedules.find((s) => s.id === "D1");
  items.push(
    checklistItem(
      "car",
      "D1 car method (cents/km or logbook) and registration",
      carClaim
        ? identity.cars.length
          ? "have"
          : "unknown"
        : "unknown",
      carClaim
        ? identity.cars.length
          ? `${identity.cars.length} vehicle(s) on Profile; active work-use ${identity.activeCarWorkUsePercent != null ? `${identity.activeCarWorkUsePercent}%` : "—"}.`
          : "Car deductions exist but no vehicle is saved on Profile."
        : "No D1 car claim in this year yet."
    )
  );

  items.push(
    checklistItem(
      "travel_days",
      "Work travel / LAFHA days",
      travel && travel.daysClaimed > 0 ? "have" : "unknown",
      travel && travel.daysClaimed > 0
        ? `${travel.daysClaimed} day(s) from payslips / edits.`
        : "No travel-allowance days recorded."
    )
  );

  items.push(
    checklistItem(
      "private_health",
      "Private health insurance statement (rebate / Medicare levy surcharge)",
      "unknown",
      "Not collected in the app. Agent needs the health fund annual statement."
    )
  );
  items.push(
    checklistItem(
      "help",
      "HELP / HECS / student loan balance",
      "unknown",
      "Not collected in the app. Agent checks myGov or the ATO income statement."
    )
  );
  items.push(
    checklistItem(
      "spouse",
      "Spouse details (offsets, MLS, family tax)",
      "unknown",
      "Not collected in the app. Ask if the taxpayer had a spouse for the year."
    )
  );
  items.push(
    checklistItem(
      "interest_dividends",
      "Bank interest and dividend statements",
      income.items.some((i) => i.item === "10" || i.item === "11") ? "have" : "unknown",
      income.items.some((i) => i.item === "10" || i.item === "11")
        ? "Some interest or dividends are already in the ledger — confirm annual statements."
        : "None entered. Agent still asks for bank and share statements."
    )
  );

  if (identity.extraEntities.length) {
    const extra = identity.extraEntities[0];
    items.push(
      checklistItem(
        "extra_entity",
        "Second entity on this login",
        "have",
        `${extra.entityType === "sole_trader" ? "Sole trader" : extra.entityType}${extra.tradingName ? ` — ${extra.tradingName}` : ""}${extra.abn ? ` ABN ${extra.abn}` : ""}. Briefing is for the active entity only.`
      )
    );
  }

  const missing = items.filter((i) => i.status === "missing").length;
  const unknown = items.filter((i) => i.status === "unknown").length;
  return {
    items,
    missingCount: missing,
    unknownCount: unknown,
    haveCount: items.filter((i) => i.status === "have").length,
  };
}

function buildAgentNotes(registration, identity, payg) {
  const notes = [];
  notes.push(registration.notes);
  if (registration.driverTypeLabel) {
    notes.push(`Driver type on file: ${registration.driverTypeLabel}.`);
  }
  if (identity.licenceClass) {
    notes.push(`Licence class: ${identity.licenceClass.toUpperCase()}.`);
  }
  if (payg.withheld > 0) {
    notes.push(
      `PAYG withheld in the app is ${payg.withheld.toFixed(2)}. Compare to the ATO income statement before calculating a refund or tax payable.`
    );
  }
  if (registration.id === "employee") {
    notes.push(
      "Super Guarantee is an employer cost and is not usually a deduction on the individual return unless the employee made a personal concessional contribution."
    );
  }
  if (registration.id === "sole_trader") {
    notes.push(
      "Confirm cash versus accruals, PSI (if personal services), and whether instant asset write-off invoices are in the asset register."
    );
  }
  if (registration.id === "partnership") {
    notes.push(
      "The partnership lodges its own return. This pack is the individual’s share plus any partner-level deductions."
    );
  }
  notes.push("This working paper is not lodged with the ATO and is not tax advice.");
  return notes;
}

function buildAccountantPack(records, profile = {}, opts = {}) {
  const product = opts.product === "suite" ? "suite" : "haulage";
  const fy =
    String(opts.financialYear || profile.financialYear || (records.profile && records.profile.financialYear) || "").trim();
  const active = withActiveLedger(records || {});
  const registration = resolveRegistration(profile, product);
  const identity = buildIdentity({ ...profile, financialYear: fy }, registration, product);
  const income = buildIncomeSchedules(active.income, fy, product, registration, identity);
  const deductions = buildDeductionSchedules(active.expenses, fy, product, registration);
  const paygVisual = payslipTaxVisualFromRecords(active, fy, { getFinancialYearForDate });
  const summary = opts.summary || {};
  const summaryIncome = summary.income || {};
  const summaryTax = summary.taxEstimate || {};
  const withheld = firstDefinedMoney(
    summaryIncome.paygWithheld,
    paygVisual.incomeTax,
    income.payers.reduce((a, p) => a + p.paygWithheld, 0)
  );
  const assessable = firstDefinedMoney(summaryIncome.assessableTotal, income.assessableTotal);
  const deductible = firstDefinedMoney(
    summary.expenses && summary.expenses.deductibleTotal,
    deductions.deductibleTotal
  );
  const taxable = firstDefinedMoney(summaryTax.taxableIncome, Math.max(0, assessable - deductible));
  const estimatedTax = firstDefinedMoney(
    summaryTax.estimatedTax,
    summaryTax.totalTax,
    num(summaryTax.incomeTax) + num(summaryTax.medicareLevy)
  );
  const taxPayable = firstDefinedMoney(summaryTax.taxPayable, estimatedTax - withheld);
  const travel = summariseOvernightDays(active, profile, fy);
  const payg = {
    withheld,
    estimatedTax,
    taxPayable,
    direction: taxPayable > 0 ? "pay" : taxPayable < 0 ? "refund" : "nil",
    refundEstimate: taxPayable < 0 ? moneyNum(Math.abs(taxPayable)) : 0,
  };
  const checklist = buildChecklist(identity, registration, income, deductions, payg, travel);

  return {
    kind: "taxpayer_briefing",
    product,
    financialYear: fy,
    generatedAt: new Date().toISOString(),
    registration,
    identity,
    income,
    deductions,
    payg,
    totals: {
      assessableIncome: assessable,
      deductibleExpenses: deductible,
      taxableIncome: taxable,
      estimatedTax,
      paygWithheld: withheld,
      taxPayable,
    },
    travel: {
      daysClaimed: travel.daysClaimed || 0,
      daysInFy: travel.daysInFy || 0,
      determination: travel.determination || "",
      ratePerDay: travel.ratePerDay || 0,
      entryCount: travel.entryCount || 0,
    },
    checklist,
    agentNotes: buildAgentNotes(registration, identity, payg),
    disclaimer:
      "Prepared for a registered tax agent. Not tax advice and not a lodged return. Verify every figure against source records, the ATO income statement, and current ATO guidance.",
  };
}

module.exports = {
  resolveRegistration,
  mapIncomeItem,
  deductionBucket,
  buildAccountantPack,
};
