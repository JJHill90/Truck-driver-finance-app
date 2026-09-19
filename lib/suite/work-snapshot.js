/**
 * Dashboard / Forecast replacement when the taxpayer does not claim overnight
 * work-travel allowances: YTD work-related claims plus occupation-specific
 * ATO toolkit hints (home office, uniforms, self-education, etc.).
 */

const { getFinancialYearForDate, homeOfficeRateForYear } = require("./ato");
const { getCategoryMeta } = require("./ato");
const { findOccupation } = require("./occupations");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function entryInFy(row, fy) {
  if (!row || !row.date) return false;
  try {
    return getFinancialYearForDate(row.date) === fy;
  } catch {
    return false;
  }
}

function paygFromEntry(row) {
  const n = Number(row.taxWithheld ?? row.payg ?? row.paygWithheld ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function buildWorkSnapshot(records = {}, profile = {}, financialYear) {
  const fy = financialYear || profile.financialYear || "";
  const occ = findOccupation(profile.occupationId || profile.occupation);
  const expenses = Array.isArray(records.expenses) ? records.expenses : [];
  const income = Array.isArray(records.income) ? records.income : [];

  const byCat = {};
  let deductibleTotal = 0;
  let homeOfficeHours = 0;
  let homeOfficeClaim = 0;

  for (const row of expenses) {
    if (fy && !entryInFy(row, fy)) continue;
    if (row.deletedAt) continue;
    const amount = Number(row.deductibleAmount ?? row.amount) || 0;
    const cat = row.category || "other_work";
    if (!byCat[cat]) {
      const meta = getCategoryMeta(cat) || {};
      byCat[cat] = { id: cat, label: meta.label || cat, deductibleTotal: 0, count: 0 };
    }
    byCat[cat].deductibleTotal = round2(byCat[cat].deductibleTotal + amount);
    byCat[cat].count += 1;
    deductibleTotal = round2(deductibleTotal + amount);
    if (cat === "home_office_hours") {
      homeOfficeHours += Number(row.hours || row.homeOfficeHours || 0) || 0;
      homeOfficeClaim = round2(homeOfficeClaim + amount);
    }
  }

  let paygWithheld = 0;
  let incomeTotal = 0;
  for (const row of income) {
    if (fy && !entryInFy(row, fy)) continue;
    if (row.deletedAt) continue;
    paygWithheld = round2(paygWithheld + paygFromEntry(row));
    incomeTotal = round2(incomeTotal + (Number(row.amount) || 0));
  }

  const topCategories = Object.values(byCat)
    .sort((a, b) => b.deductibleTotal - a.deductibleTotal)
    .slice(0, 5);

  const rate = homeOfficeRateForYear(fy);
  const hints = (occ && occ.deductionHints) || [
    "Claim only expenses with a sufficient connection to your current job.",
    "Keep receipts. Work-related claims over $300 generally need written evidence.",
    "Home-to-work commuting is usually private.",
  ];

  const occLabel = occ ? (occ.parent ? `${occ.parent} · ${occ.name}` : occ.name) : profile.occupation || "your occupation";

  return {
    enabled: false,
    title: "Work-related claims",
    occupation: occ
      ? {
          id: occ.id,
          name: occ.name,
          parent: occ.parent,
          group: occ.group,
          label: occLabel,
          typicalOvernight: occ.typicalOvernight,
          travelKind: occ.travelKind,
          travelLabel: occ.travelLabel,
        }
      : profile.occupation
        ? { name: profile.occupation, label: profile.occupation }
        : null,
    financialYear: fy,
    deductibleTotal,
    incomeTotal,
    paygWithheld,
    topCategories,
    homeOfficeHours: round2(homeOfficeHours),
    homeOfficeClaim,
    homeOfficeRate: rate,
    deductionHints: hints,
    emptyHint:
      "Add receipts on Expenses to see YTD work-related claims here. Overnight travel cards stay hidden until you tick travel + overnight allowance on Profile.",
    note:
      `Occupation snapshot for ${occLabel}. ATO occupation toolkits list typical claims ` +
      `(home office, uniforms, self-education, union fees). This is not an overnight travel ` +
      `allowance card — tick Profile → travel for work and overnight allowance if you sleep ` +
      `away from home for work and are paid a travel allowance.`,
  };
}

module.exports = {
  buildWorkSnapshot,
};
