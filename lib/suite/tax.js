/**
 * Tax engine for Go Taxation Suite: PAYG employees, sole traders, partnerships.
 * Uses suite ATO categories (not the truck-driver occupation tables).
 */

const {
  EXPENSE_CATEGORIES,
  INCOME_TYPES,
  SUBSTANTIATION,
  LAUNDRY_RATES,
  getFinancialYearForDate,
  incomeTaxForYear,
  budgetRepairLevy,
  centsPerKmForYear,
  homeOfficeRateForYear,
  instantAssetWriteOffForYear,
  calcLito,
  calcMedicareLevyShaded,
  getCategoryMeta,
  mealCapsForYear,
} = require("./ato");
const { workTravelMealLabels } = require("./travel");
const { normalizeEntityType } = require("./profile");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function calcExpenseDeduction(entry, profile = {}) {
  const meta = EXPENSE_CATEGORIES[entry.category] || getCategoryMeta(entry.category);
  if (!meta) {
    return {
      grossAmount: Number(entry.amount) || 0,
      deductibleAmount: 0,
      cappedAmount: 0,
      workPortion: 0,
      warnings: ["Unknown expense category."],
    };
  }

  const fy = profile.financialYear || getFinancialYearForDate(entry.date);
  const entity = normalizeEntityType(profile.entityType || profile.driverType);
  const amount = Number(entry.amount) || 0;
  const workUsePct = entry.workUsePercent != null ? Math.min(100, Math.max(0, entry.workUsePercent)) : 100;
  const workPortion = round2(amount * (workUsePct / 100));
  const warnings = [];
  let capped = workPortion;

  if (entry.reimbursed) {
    return {
      grossAmount: amount,
      deductibleAmount: 0,
      cappedAmount: 0,
      workPortion: 0,
      warnings: ["Reimbursed expenses are not deductible."],
      substantiation: meta.substantiation,
    };
  }

  const salary = Number(profile.annualSalary) || 0;
  const meals = mealCapsForYear(fy, salary);

  const mealCapById = {
    meals: meals.mealsDaily,
    meals_breakfast: meals.breakfast,
    meals_lunch: meals.lunch,
    meals_dinner: meals.dinner,
    overtime_meals: meals.overtimeMealCap,
  };
  if (mealCapById[entry.category] != null) {
    const cap = mealCapById[entry.category];
    capped = Math.min(workPortion, cap);
    if (workPortion > cap) {
      warnings.push(
        `Capped at ATO reasonable amount $${cap.toFixed(2)} (${meals.determination}) — claimed $${workPortion.toFixed(2)}.`
      );
    }
  }

  if (entry.category === "vehicle_car" && entry.method === "cents_per_km") {
    const km = Number(entry.kilometres) || 0;
    const rate = centsPerKmForYear(fy);
    const cappedKm = Math.min(km, 5000);
    capped = round2(cappedKm * rate);
    if (km > 5000) warnings.push("Cents/km limited to 5,000 km per year.");
  }

  if (entry.category === "laundry") {
    const loads = Number(entry.laundryLoads) || 0;
    const mixed = Boolean(entry.laundryMixed);
    const rate = mixed ? LAUNDRY_RATES.mixedLoad : LAUNDRY_RATES.workOnlyLoad;
    const calculated = round2(loads * rate);
    capped = entry.amount ? Math.min(workPortion, calculated || workPortion) : calculated;
  }

  if (entry.category === "home_office_hours") {
    const hours = Number(entry.hours || entry.homeOfficeHours || entry.kilometres) || 0;
    const rate = homeOfficeRateForYear(fy);
    if (hours > 0) {
      capped = round2(hours * rate);
    } else if (amount > 0) {
      // Amount entered as dollars; treat as already computed hours × rate.
      capped = workPortion;
      warnings.push("Enter hours worked from home so the 70c (or year-correct) fixed rate can be applied.");
    } else {
      capped = 0;
      warnings.push("Add the number of hours you worked from home.");
    }
  }

  if (entry.category === "tools_equipment" || entry.category === "computer_software") {
    const iawo = instantAssetWriteOffForYear(fy);
    if (entity === "employee" && workPortion > SUBSTANTIATION.toolsImmediateWriteOff) {
      warnings.push(
        `Employees generally deduct items over $${SUBSTANTIATION.toolsImmediateWriteOff} via decline in value, not an immediate write-off.`
      );
    } else if (entity !== "employee" && workPortion > iawo) {
      warnings.push(
        `Over the small-business instant asset write-off threshold ($${iawo.toLocaleString("en-AU")} for ${fy}) — consider decline in value.`
      );
    }
  }

  if (entry.category === "donations_dgr" && workPortion < 2 && workPortion > 0) {
    warnings.push("DGR gifts are deductible from $2.");
  }

  const needsReceipt =
    meta.substantiation === "written_evidence" ||
    meta.substantiation === "receipt" ||
    meta.substantiation === "receipt_and_work_use" ||
    meta.substantiation === "notice_of_intent";

  return {
    grossAmount: amount,
    deductibleAmount: round2(capped),
    cappedAmount: round2(capped),
    workPortion: round2(workPortion),
    maxAllowed: mealCapById[entry.category] != null ? mealCapById[entry.category] : null,
    substantiation: meta.substantiation,
    needsReceipt,
    warnings,
    atoSchedule: meta.atoSchedule,
    label: meta.label,
  };
}

function calcIncomeAssessability(entry) {
  const meta = INCOME_TYPES[entry.type];
  const amount = Number(entry.amount) || 0;
  const assessableBase =
    Number(entry.taxableIncome) > 0
      ? Number(entry.taxableIncome)
      : Number(entry.grossTotal) > 0
        ? Number(entry.grossTotal)
        : amount;

  if (!meta) return { amount: assessableBase, assessable: assessableBase, notes: "" };

  if (meta.assessable === true) {
    return { amount: assessableBase, assessable: assessableBase, notes: meta.notes };
  }
  if (meta.assessable === false) {
    return { amount: assessableBase, assessable: 0, notes: meta.notes };
  }
  if (meta.assessable === "if_claiming") {
    const claiming = Boolean(entry.claimingDeduction);
    return {
      amount: assessableBase,
      assessable: claiming ? assessableBase : 0,
      notes: claiming
        ? "Allowance included as income because a related deduction is claimed."
        : "Allowance not declared (no related deduction claimed).",
    };
  }
  return { amount: assessableBase, assessable: assessableBase, notes: meta.notes };
}

function paygFromEntry(entry) {
  const n = Number(entry && (entry.taxWithheld || entry.paygWithheld || entry.payg));
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

function gstFromEntry(entry, field) {
  const n = Number(entry && entry[field]);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

function summariseYear(records, profile = {}) {
  const fyFilter = profile.financialYear;
  const entity = normalizeEntityType(profile.entityType || profile.driverType);
  const expenses = (records.expenses || []).filter(
    (e) => !fyFilter || getFinancialYearForDate(e.date) === fyFilter
  );
  const income = (records.income || []).filter(
    (e) => !fyFilter || getFinancialYearForDate(e.date) === fyFilter
  );

  const expenseBreakdown = {};
  let totalDeductions = 0;
  let totalGrossExpenses = 0;
  const allWarnings = [];
  let gstOnPurchases = 0;

  for (const exp of expenses) {
    const result = calcExpenseDeduction(exp, profile);
    const cat = exp.category;
    if (!expenseBreakdown[cat]) {
      expenseBreakdown[cat] = {
        category: cat,
        label: result.label || cat,
        atoSchedule: result.atoSchedule,
        count: 0,
        grossTotal: 0,
        deductibleTotal: 0,
        items: [],
      };
    }
    expenseBreakdown[cat].count += 1;
    expenseBreakdown[cat].grossTotal = round2(expenseBreakdown[cat].grossTotal + result.grossAmount);
    expenseBreakdown[cat].deductibleTotal = round2(
      expenseBreakdown[cat].deductibleTotal + result.deductibleAmount
    );
    expenseBreakdown[cat].items.push({
      id: exp.id,
      ...result,
      date: exp.date,
      description: exp.description,
    });
    totalDeductions = round2(totalDeductions + result.deductibleAmount);
    totalGrossExpenses = round2(totalGrossExpenses + result.grossAmount);
    gstOnPurchases = round2(gstOnPurchases + gstFromEntry(exp, "gstAmount") + gstFromEntry(exp, "gst"));
    allWarnings.push(...result.warnings.map((w) => ({ expenseId: exp.id, message: w })));
  }

  const incomeBreakdown = {};
  let totalAssessable = 0;
  let totalGrossIncome = 0;
  let paygWithheld = 0;
  let gstOnSales = 0;

  for (const inc of income) {
    const result = calcIncomeAssessability(inc);
    let assessable = result.assessable;
    if (entity === "partnership" && inc.type === "partnership_distribution") {
      const share = Number(profile.partnerSharePercent);
      if (Number.isFinite(share) && share > 0 && share < 100 && !inc.shareAlreadyApplied) {
        assessable = round2(assessable * (share / 100));
      }
    }
    const type = inc.type;
    if (!incomeBreakdown[type]) {
      incomeBreakdown[type] = {
        type,
        label: (INCOME_TYPES[type] && INCOME_TYPES[type].label) || type,
        count: 0,
        grossTotal: 0,
        assessableTotal: 0,
      };
    }
    incomeBreakdown[type].count += 1;
    incomeBreakdown[type].grossTotal = round2(incomeBreakdown[type].grossTotal + result.amount);
    incomeBreakdown[type].assessableTotal = round2(incomeBreakdown[type].assessableTotal + assessable);
    totalAssessable = round2(totalAssessable + assessable);
    totalGrossIncome = round2(totalGrossIncome + result.amount);
    paygWithheld = round2(paygWithheld + paygFromEntry(inc));
    gstOnSales = round2(gstOnSales + gstFromEntry(inc, "gstAmount") + gstFromEntry(inc, "gst"));
  }

  const annualSalary = profile.annualSalary || totalAssessable;
  const fy = fyFilter || "all";
  const meals = mealCapsForYear(fyFilter, annualSalary);

  const taxableIncome = round2(Math.max(0, totalAssessable - totalDeductions));
  const incomeTaxRaw = incomeTaxForYear(taxableIncome, fyFilter);
  const lito = calcLito(taxableIncome);
  const incomeTax = round2(Math.max(0, incomeTaxRaw - lito));
  const medicare = calcMedicareLevyShaded(taxableIncome, fyFilter);
  const levy = budgetRepairLevy(taxableIncome, fyFilter);
  const estimatedTax = round2(incomeTax + medicare + levy);
  const taxPayable = round2(estimatedTax - paygWithheld);

  const substantiationRequired = totalDeductions > SUBSTANTIATION.totalWorkExpensesReceiptThreshold;

  const entityNotes = {
    employee:
      "PAYG employee: salary and allowances are assessable; claim only work-related deductions with a sufficient connection to your job. Super Guarantee is an employer cost (not usually your deduction).",
    sole_trader:
      "Sole trader: business profit (sales − expenses) is taxed at individual resident rates. Lodge an individual return (and activity statements if GST-registered). Instant asset write-off may apply to eligible assets.",
    partnership:
      "Partnership: the partnership is not taxed. Your distribution share plus partner salary is included in your individual taxable income.",
  };

  return {
    financialYear: fy,
    product: "gotax",
    profile: {
      entityType: entity,
      driverType: entity,
      annualSalary,
      salaryBand: meals.salaryBand,
      travelCaps: meals.domesticTravelDaily,
      gstRegistered: Boolean(profile.gstRegistered),
      occupation: profile.occupation || "",
      partnerSharePercent: Number(profile.partnerSharePercent) || (entity === "partnership" ? 50 : 100),
    },
    income: {
      grossTotal: totalGrossIncome,
      assessableTotal: totalAssessable,
      paygWithheld,
      gstOnSales,
      breakdown: Object.values(incomeBreakdown),
    },
    expenses: {
      grossTotal: totalGrossExpenses,
      deductibleTotal: totalDeductions,
      gstOnPurchases,
      breakdown: Object.values(expenseBreakdown),
    },
    allowances: {
      travelKind: "ordinary_employee",
      representativePlace: meals.representativePlace,
      salaryBand: meals.salaryBand,
      salaryBandLabel: meals.salaryBandLabel,
      workTravelMealsDaily: workTravelMealLabels(meals),
      // Same object under the haulage UI key so #allowance-caps can render without a fork.
      truckDriverMealsDaily: workTravelMealLabels(meals),
      overtimeMealCap: meals.overtimeMealCap,
      maxDailyMealsPotential: meals.mealsDaily,
      mealsAndIncidentals: meals.mealsAndIncidentals,
      dailyTravelTotal: meals.dailyTravelTotal,
      domesticTravelCaps: meals.domesticTravelDaily,
      lafhaWeekly: meals.lafhaWeekly,
      determination: meals.determination,
      tableNote: meals.tableNote,
      ratesFinancialYear: fyFilter,
      homeOfficeRate: homeOfficeRateForYear(fyFilter),
      instantAssetWriteOff: entity === "employee" ? null : instantAssetWriteOffForYear(fyFilter),
    },
    taxEstimate: {
      taxableIncome,
      incomeTax: incomeTaxRaw,
      lito,
      incomeTaxAfterOffsets: incomeTax,
      medicareLevy: medicare,
      budgetRepairLevy: levy,
      totalTax: estimatedTax,
      paygWithheld,
      taxPayable,
      refundOrPayable: taxPayable,
      effectiveRate: totalAssessable > 0 ? round2((estimatedTax / totalAssessable) * 100) : 0,
      ratesFinancialYear: fyFilter,
    },
    bas: profile.gstRegistered
      ? {
          gstOnSales,
          gstOnPurchases,
          netGst: round2(gstOnSales - gstOnPurchases),
          note: "Indicative GST from amounts you recorded — confirm on your activity statement (cash vs accruals, GST-inclusive invoices).",
        }
      : null,
    substantiation: {
      required: substantiationRequired,
      threshold: SUBSTANTIATION.totalWorkExpensesReceiptThreshold,
      message: substantiationRequired
        ? "Total work-related deductions exceed $300 — written evidence is required for claims."
        : "Keep records for all expenses; written evidence rules may still apply per category.",
    },
    entityNote: entityNotes[entity],
    warnings: allWarnings,
  };
}

function buildAccountantReport(records, profile = {}) {
  const summary = summariseYear(records, profile);
  const entity = summary.profile.entityType;
  const titles = {
    employee: "Employee (PAYG) – Performance & Tax Summary",
    sole_trader: "Sole trader – Performance & Tax Summary",
    partnership: "Partnership interest – Performance & Tax Summary",
  };
  return {
    title: titles[entity] || "Go Taxation Suite – Performance & Tax Summary",
    subtitle: `Australian financial year ${summary.financialYear}`,
    generatedAt: new Date().toISOString(),
    product: "gotax",
    driver: {
      name: profile.name || "Taxpayer",
      abn: profile.abn || null,
      employer: profile.employer || profile.tradingName || null,
      driverType: entity,
      driverTypeLabel:
        entity === "sole_trader" ? "Sole trader" : entity === "partnership" ? "Partnership" : "Employee (PAYG)",
      occupation: profile.occupation || null,
      tfnSupplied: Boolean(profile.tfnSupplied),
      gstRegistered: Boolean(profile.gstRegistered),
      partnershipName: profile.partnershipName || null,
    },
    disclaimer:
      "Prepared for accountant review. Not tax advice. Verify against current ATO guidance and individual circumstances. Go Taxation Suite applies general PAYG, sole trader and partnership rules — not occupation-specific truck-driver determinations.",
    summary,
    atoScheduleMapping: summary.expenses.breakdown.map((b) => ({
      schedule: b.atoSchedule,
      category: b.label,
      deductibleAmount: b.deductibleTotal,
      transactionCount: b.count,
    })),
    incomeSchedule: summary.income.breakdown.map((b) => ({
      type: b.label,
      assessableAmount: b.assessableTotal,
      grossAmount: b.grossTotal,
    })),
  };
}

function decorateAccountantReport(report) {
  if (!report || typeof report !== "object") return report;
  const entity = (report.driver && report.driver.driverType) || "employee";
  const titles = {
    employee: "Employee (PAYG) – Performance & Tax Summary",
    sole_trader: "Sole trader – Performance & Tax Summary",
    partnership: "Partnership interest – Performance & Tax Summary",
  };
  report.title = titles[entity] || "Go Taxation Suite – Performance & Tax Summary";
  if (report.driver) {
    report.driver.driverTypeLabel =
      entity === "sole_trader"
        ? "Sole trader"
        : entity === "partnership"
          ? "Partnership"
          : "Employee (PAYG)";
  }
  return report;
}

module.exports = {
  round2,
  calcExpenseDeduction,
  calcIncomeAssessability,
  summariseYear,
  buildAccountantReport,
  decorateAccountantReport,
};
