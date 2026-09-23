/**
 * BAS / GST quarterly pack for sole traders and GST-registered entities.
 * GST on GST-inclusive amounts is 1/11 unless a GST figure or GST-free flag
 * is stored on the row. The pack is an ATO activity-statement worksheet
 * (G1, 1A, G11, 1B, 9) for transcription — not a lodged BAS.
 */
const { getFinancialYearForDate } = require("./ato");
const { normalizeEntityType } = require("./profile");

const GST_FRACTION = 1 / 11;

const QUARTERS = [
  { id: "q1", label: "Quarter 1 (1 Jul – 30 Sep)", shortLabel: "Q1 Jul–Sep", months: [7, 8, 9] },
  { id: "q2", label: "Quarter 2 (1 Oct – 31 Dec)", shortLabel: "Q2 Oct–Dec", months: [10, 11, 12] },
  { id: "q3", label: "Quarter 3 (1 Jan – 31 Mar)", shortLabel: "Q3 Jan–Mar", months: [1, 2, 3] },
  { id: "q4", label: "Quarter 4 (1 Apr – 30 Jun)", shortLabel: "Q4 Apr–Jun", months: [4, 5, 6] },
];

const WORKSHEET_NOTE =
  "This GST activity statement worksheet is prepared from your recorded sales and purchases so you can complete your BAS with the ATO. It is not a lodged activity statement and is not an ATO-issued form. Copy G1, 1A, G11, 1B and 9 into the ATO Business Portal, your registered agent software, or the paper form, then lodge. Amounts treat recorded totals as GST-inclusive unless a GST figure was stored or the row was marked GST-free. Confirm cash versus accruals and any G10 capital purchases before lodging. This is not tax advice.";

const HOW_TO_LODGE = [
  "Open the ATO Business Portal (or myGov → ATO → Activity statements) for the matching quarter.",
  "Copy G1 (total sales), 1A (GST on sales), G11 (non-capital purchases), 1B (GST on purchases) and 9 (payment or refund) from this worksheet.",
  "Check GST-free sales, capital purchases (G10) and cash versus accruals against your invoices.",
  "Lodge the activity statement with the ATO — or send this PDF/Excel pack to your registered tax or BAS agent.",
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function gstInclusive(amount) {
  return round2((Number(amount) || 0) * GST_FRACTION);
}

function isGstFreeEntry(entry) {
  if (!entry) return false;
  if (entry.gstFree === true || entry.gstExempt === true || entry.taxFree === true) return true;
  const flag = String(entry.gstTreatment || entry.gstStatus || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return flag === "gst_free" || flag === "input_taxed" || flag === "exempt" || flag === "gst_exempt";
}

function namedGst(entry) {
  if (!entry) return null;
  const raw = entry.gstAmount != null && entry.gstAmount !== "" ? entry.gstAmount : entry.gst;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return round2(n);
}

function gstOf(entry, amount) {
  if (isGstFreeEntry(entry)) return 0;
  const named = namedGst(entry);
  return named != null ? named : gstInclusive(amount);
}

function monthOf(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getMonth() + 1;
}

function findQuarter(id) {
  const key = String(id || "").toLowerCase();
  return QUARTERS.find((q) => q.id === key) || null;
}

function inQuarter(date, quarter) {
  if (!quarter) return true;
  const m = monthOf(date);
  return quarter.months.includes(m);
}

function eligibleForBas(profile = {}) {
  const entity = normalizeEntityType(profile.entityType || profile.driverType);
  if (profile.gstRegistered) return true;
  return entity === "sole_trader" || entity === "partnership";
}

function parseFinancialYear(fy) {
  const m = String(fy || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = Number(m[1]);
  const endYear = startYear + 1;
  if (endYear % 100 !== Number(m[2])) return { startYear, endYear: startYear + 1 };
  return { startYear, endYear };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function weekdayUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDaysUtc(year, month, day, days) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextBusinessDay(year, month, day) {
  let y = year;
  let m = month;
  let d = day;
  let rolled = false;
  for (let i = 0; i < 4; i += 1) {
    const wd = weekdayUtc(y, m, d);
    if (wd !== 0 && wd !== 6) {
      return { year: y, month: m, day: d, iso: isoDate(y, m, d), rolled };
    }
    const next = addDaysUtc(y, m, d, wd === 6 ? 2 : 1);
    y = next.year;
    m = next.month;
    d = next.day;
    rolled = true;
  }
  return { year: y, month: m, day: d, iso: isoDate(y, m, d), rolled };
}

const QUARTER_PERIODS = {
  q1: { startMonth: 7, startDay: 1, endMonth: 9, endDay: 30, dueMonth: 10, dueDay: 28, dueYearOffset: 0 },
  q2: { startMonth: 10, startDay: 1, endMonth: 12, endDay: 31, dueMonth: 2, dueDay: 28, dueYearOffset: 1 },
  q3: { startMonth: 1, startDay: 1, endMonth: 3, endDay: 31, dueMonth: 4, dueDay: 28, dueYearOffset: 1 },
  q4: { startMonth: 4, startDay: 1, endMonth: 6, endDay: 30, dueMonth: 7, dueDay: 28, dueYearOffset: 1 },
};

function formatDisplayDate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function periodForQuarter(quarterId, fy) {
  const years = parseFinancialYear(fy);
  const spec = QUARTER_PERIODS[quarterId];
  if (!years || !spec) {
    return {
      start: null,
      end: null,
      startLabel: null,
      endLabel: null,
      dueDate: null,
      dueDateLabel: null,
      statutoryDueDate: null,
      dueDateRolled: false,
      dueDateNote: null,
    };
  }
  const startYear = spec.startMonth >= 7 ? years.startYear : years.endYear;
  const endYear = spec.endMonth >= 7 ? years.startYear : years.endYear;
  const dueYear = years.startYear + spec.dueYearOffset;
  const statutory = isoDate(dueYear, spec.dueMonth, spec.dueDay);
  const due = nextBusinessDay(dueYear, spec.dueMonth, spec.dueDay);
  const start = isoDate(startYear, spec.startMonth, spec.startDay);
  const end = isoDate(endYear, spec.endMonth, spec.endDay);
  return {
    start,
    end,
    startLabel: formatDisplayDate(start),
    endLabel: formatDisplayDate(end),
    dueDate: due.iso,
    dueDateLabel: formatDisplayDate(due.iso),
    statutoryDueDate: statutory,
    statutoryDueDateLabel: formatDisplayDate(statutory),
    dueDateRolled: due.rolled,
    dueDateNote: due.rolled
      ? `Statutory due date ${formatDisplayDate(statutory)} falls on a weekend; this worksheet uses the next business day ${formatDisplayDate(due.iso)}. ATO public holidays may extend this further.`
      : "Lodge by this date unless the ATO publishes a public-holiday extension.",
  };
}

function fullYearPeriod(fy) {
  const years = parseFinancialYear(fy);
  if (!years) {
    return { start: null, end: null, startLabel: null, endLabel: null };
  }
  const start = isoDate(years.startYear, 7, 1);
  const end = isoDate(years.endYear, 6, 30);
  return {
    start,
    end,
    startLabel: formatDisplayDate(start),
    endLabel: formatDisplayDate(end),
  };
}

function formatAbn(abn) {
  const digits = String(abn || "").replace(/\D/g, "");
  if (digits.length !== 11) return String(abn || "").trim();
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

function currentQuarterId(now = new Date()) {
  const m = now.getMonth() + 1;
  if (m >= 7 && m <= 9) return "q1";
  if (m >= 10) return "q2";
  if (m <= 3) return "q3";
  return "q4";
}

function atoBoxes({ sales, purchases, gstOnSales, gstOnPurchases, netGst }) {
  const pay = netGst >= 0;
  return [
    {
      id: "G1",
      atoBox: "G1",
      label: "Total sales",
      amount: sales,
      hint: "GST-inclusive sales for the period, including GST-free sales.",
    },
    {
      id: "1A",
      atoBox: "1A",
      label: "GST on sales",
      amount: gstOnSales,
      hint: "GST collected. Uses a stored GST figure, otherwise 1/11 of taxable sales. GST-free rows are excluded.",
    },
    {
      id: "G11",
      atoBox: "G11",
      label: "Non-capital purchases",
      amount: purchases,
      hint: "GST-inclusive purchases. This ledger does not split capital purchases (G10).",
    },
    {
      id: "1B",
      atoBox: "1B",
      label: "GST on purchases",
      amount: gstOnPurchases,
      hint: "GST credits claimed. GST-free purchases do not generate a credit.",
    },
    {
      id: "9",
      atoBox: "9",
      label: pay ? "Payment" : "Refund",
      amount: round2(Math.abs(netGst)),
      signedAmount: netGst,
      direction: pay ? "pay" : "refund",
      hint: pay
        ? "Amount to pay the ATO (1A minus 1B). Other BAS labels such as PAYG are not included."
        : "Refund due from the ATO (1B minus 1A). Other BAS labels such as PAYG are not included.",
    },
  ];
}

function identityFromProfile(profile = {}) {
  const name = String(profile.name || "").trim();
  const tradingName = String(profile.tradingName || profile.employer || profile.partnershipName || "").trim();
  const abnRaw = String(profile.abn || "").replace(/\s/g, "");
  return {
    name: name || null,
    tradingName: tradingName || null,
    abn: abnRaw || null,
    abnFormatted: formatAbn(abnRaw) || null,
    entityType: normalizeEntityType(profile.entityType || profile.driverType),
    gstRegistered: Boolean(profile.gstRegistered),
  };
}

function tallyPeriod(income, expenses) {
  let sales = 0;
  let gstOnSales = 0;
  let gstFreeSales = 0;
  let gstFreeIncomeCount = 0;
  for (const inc of income) {
    const amount = Number(inc.amount) || 0;
    sales = round2(sales + amount);
    if (isGstFreeEntry(inc)) {
      gstFreeSales = round2(gstFreeSales + amount);
      gstFreeIncomeCount += 1;
    }
    gstOnSales = round2(gstOnSales + gstOf(inc, amount));
  }

  let purchases = 0;
  let gstOnPurchases = 0;
  let gstFreePurchases = 0;
  let gstFreeExpenseCount = 0;
  for (const exp of expenses) {
    const amount = Number(exp.amount) || 0;
    purchases = round2(purchases + amount);
    if (isGstFreeEntry(exp)) {
      gstFreePurchases = round2(gstFreePurchases + amount);
      gstFreeExpenseCount += 1;
    }
    gstOnPurchases = round2(gstOnPurchases + gstOf(exp, amount));
  }

  const netGst = round2(gstOnSales - gstOnPurchases);
  return {
    sales,
    purchases,
    gstOnSales,
    gstOnPurchases,
    netGst,
    gstFreeSales,
    gstFreePurchases,
    gstFreeIncomeCount,
    gstFreeExpenseCount,
    incomeCount: income.length,
    expenseCount: expenses.length,
    boxes: atoBoxes({ sales, purchases, gstOnSales, gstOnPurchases, netGst }),
  };
}

function filterByFyAndQuarter(rows, fy, quarter) {
  return (rows || []).filter((e) => {
    if (fy && getFinancialYearForDate(e.date) !== fy) return false;
    return inQuarter(e.date, quarter);
  });
}

function buildBasPack(records, profile = {}, opts = {}) {
  const fy = String(opts.financialYear || profile.financialYear || "").trim();
  const quarter = findQuarter(opts.quarter);
  const expenses = filterByFyAndQuarter(records.expenses, fy, quarter);
  const income = filterByFyAndQuarter(records.income, fy, quarter);
  const totals = tallyPeriod(income, expenses);
  const identity = identityFromProfile(profile);
  const period = quarter ? periodForQuarter(quarter.id, fy) : fullYearPeriod(fy);
  const generatedAt = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();

  let quarterly = null;
  if (!quarter && fy) {
    quarterly = QUARTERS.map((q) => {
      const qIncome = filterByFyAndQuarter(records.income, fy, q);
      const qExpenses = filterByFyAndQuarter(records.expenses, fy, q);
      return {
        id: q.id,
        label: q.label,
        shortLabel: q.shortLabel,
        period: periodForQuarter(q.id, fy),
        ...tallyPeriod(qIncome, qExpenses),
      };
    });
  }

  return {
    documentTitle: "GST activity statement worksheet",
    documentKind: "gst_activity_statement_worksheet",
    officialForm: false,
    lodgement: {
      channel: "ato_business_portal",
      officialForm: false,
      howToLodge: HOW_TO_LODGE,
    },
    financialYear: fy || null,
    quarter: quarter ? quarter.id : "all",
    quarterLabel: quarter ? quarter.label : "Full financial year",
    quarterShortLabel: quarter ? quarter.shortLabel : "Full year",
    period,
    dueDate: period.dueDate || null,
    dueDateLabel: period.dueDateLabel || null,
    identity,
    gstRegistered: identity.gstRegistered,
    entityType: identity.entityType,
    eligible: eligibleForBas(profile),
    gstFraction: "1/11",
    accountingMethodNote:
      "Figures follow the dates on your income and expense rows (cash-style). If you account on an accruals basis, confirm invoice dates before lodging.",
    generatedAt,
    sales: totals.sales,
    purchases: totals.purchases,
    gstOnSales: totals.gstOnSales,
    gstOnPurchases: totals.gstOnPurchases,
    netGst: totals.netGst,
    gstFreeSales: totals.gstFreeSales,
    gstFreePurchases: totals.gstFreePurchases,
    gstFreeIncomeCount: totals.gstFreeIncomeCount,
    gstFreeExpenseCount: totals.gstFreeExpenseCount,
    incomeCount: totals.incomeCount,
    expenseCount: totals.expenseCount,
    boxes: totals.boxes,
    quarterly,
    quarters: QUARTERS.map((q) => ({ id: q.id, label: q.label, shortLabel: q.shortLabel })),
    note: WORKSHEET_NOTE,
  };
}

function basDownloadStem(pack, product = "suite") {
  const brand = product === "suite" ? "gotax" : "haulage";
  const fy = String((pack && pack.financialYear) || "fy").replace(/[^\d-]/g, "") || "fy";
  const q = pack && pack.quarter && pack.quarter !== "all" ? pack.quarter : "year";
  return `${brand}-bas-${fy}-${q}`;
}

module.exports = {
  GST_FRACTION,
  QUARTERS,
  WORKSHEET_NOTE,
  HOW_TO_LODGE,
  gstInclusive,
  gstOf,
  isGstFreeEntry,
  eligibleForBas,
  formatAbn,
  currentQuarterId,
  periodForQuarter,
  nextBusinessDay,
  atoBoxes,
  buildBasPack,
  basDownloadStem,
};
