const {
  EXPENSE_CATEGORIES,
  INCOME_TYPES,
  CENTS_PER_KM,
  LAUNDRY_RATES,
  SUBSTANTIATION,
  TAX_BRACKETS,
  MEDICARE_LEVY_RATE,
  TRUCK_DRIVER_MEALS,
  OVERTIME_MEAL_CAP,
  getFinancialYearForDate,
  getSalaryBand,
  DOMESTIC_TRAVEL_DAILY,
} = require("./ato-standards");

function round2(n) {
  return Math.round(n * 100) / 100;
}

function calcMarginalTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const bracket of TAX_BRACKETS) {
    const band = Math.min(taxableIncome, bracket.upTo) - prev;
    if (band > 0) tax += band * bracket.rate;
    prev = bracket.upTo;
    if (taxableIncome <= bracket.upTo) break;
  }
  return round2(tax);
}

function calcMedicareLevy(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  return round2(taxableIncome * MEDICARE_LEVY_RATE);
}

/**
 * Calculate maximum deductible amount for a single expense entry.
 */
function calcExpenseDeduction(entry) {
  const meta = EXPENSE_CATEGORIES[entry.category];
  if (!meta) {
    return {
      grossAmount: entry.amount,
      deductibleAmount: 0,
      cappedAmount: 0,
      workPortion: 0,
      warnings: ["Unknown expense category."],
    };
  }

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

  if (meta.cap != null) {
    capped = Math.min(workPortion, meta.cap);
    if (workPortion > meta.cap) {
      warnings.push(`Capped at ATO reasonable amount $${meta.cap.toFixed(2)} (claimed $${workPortion.toFixed(2)}).`);
    }
  }

  if (entry.category === "vehicle_car" && entry.method === "cents_per_km") {
    const km = Number(entry.kilometres) || 0;
    const cappedKm = Math.min(km, CENTS_PER_KM.maxKm);
    capped = round2(cappedKm * CENTS_PER_KM.rate);
    if (km > CENTS_PER_KM.maxKm) {
      warnings.push(`Cents/km limited to ${CENTS_PER_KM.maxKm} km per year.`);
    }
  }

  if (entry.category === "laundry") {
    const loads = Number(entry.laundryLoads) || 0;
    const mixed = Boolean(entry.laundryMixed);
    const rate = mixed ? LAUNDRY_RATES.mixedLoad : LAUNDRY_RATES.workOnlyLoad;
    const calculated = round2(loads * rate);
    capped = entry.amount ? Math.min(workPortion, calculated || workPortion) : calculated;
  }

  const needsReceipt =
    meta.substantiation === "written_evidence" ||
    meta.substantiation === "receipt" ||
    (meta.substantiation === "receipt_and_work_use" && amount > 0);

  return {
    grossAmount: amount,
    deductibleAmount: round2(capped),
    cappedAmount: round2(capped),
    workPortion: round2(workPortion),
    maxAllowed: meta.cap ?? null,
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
  if (!meta) return { amount, assessable: amount, notes: "" };

  if (meta.assessable === true) {
    return { amount, assessable: amount, notes: meta.notes };
  }
  if (meta.assessable === false) {
    return { amount, assessable: 0, notes: meta.notes };
  }
  if (meta.assessable === "if_claiming") {
    const claiming = Boolean(entry.claimingDeduction);
    return {
      amount,
      assessable: claiming ? amount : 0,
      notes: claiming
        ? "Allowance included as income because related deduction is claimed."
        : "Allowance not declared (no related deduction claimed).",
    };
  }
  return { amount, assessable: amount, notes: meta.notes };
}

function summariseYear(records, profile = {}) {
  const fyFilter = profile.financialYear;
  const expenses = records.expenses.filter(
    (e) => !fyFilter || getFinancialYearForDate(e.date) === fyFilter
  );
  const income = records.income.filter(
    (e) => !fyFilter || getFinancialYearForDate(e.date) === fyFilter
  );

  const expenseBreakdown = {};
  let totalDeductions = 0;
  let totalGrossExpenses = 0;
  const allWarnings = [];

  for (const exp of expenses) {
    const result = calcExpenseDeduction(exp);
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
    expenseBreakdown[cat].deductibleTotal = round2(expenseBreakdown[cat].deductibleTotal + result.deductibleAmount);
    expenseBreakdown[cat].items.push({ id: exp.id, ...result, date: exp.date, description: exp.description });
    totalDeductions = round2(totalDeductions + result.deductibleAmount);
    totalGrossExpenses = round2(totalGrossExpenses + result.grossAmount);
    allWarnings.push(...result.warnings.map((w) => ({ expenseId: exp.id, message: w })));
  }

  const incomeBreakdown = {};
  let totalAssessable = 0;
  let totalGrossIncome = 0;

  for (const inc of income) {
    const result = calcIncomeAssessability(inc);
    const type = inc.type;
    if (!incomeBreakdown[type]) {
      incomeBreakdown[type] = {
        type,
        label: INCOME_TYPES[type]?.label || type,
        count: 0,
        grossTotal: 0,
        assessableTotal: 0,
      };
    }
    incomeBreakdown[type].count += 1;
    incomeBreakdown[type].grossTotal = round2(incomeBreakdown[type].grossTotal + result.amount);
    incomeBreakdown[type].assessableTotal = round2(incomeBreakdown[type].assessableTotal + result.assessable);
    totalAssessable = round2(totalAssessable + result.assessable);
    totalGrossIncome = round2(totalGrossIncome + result.amount);
  }

  const annualSalary = profile.annualSalary || totalAssessable;
  const salaryBand = getSalaryBand(annualSalary);
  const travelCaps = DOMESTIC_TRAVEL_DAILY[salaryBand];

  const mealAllowancePotential = round2(
    TRUCK_DRIVER_MEALS.breakfast.cap +
      TRUCK_DRIVER_MEALS.lunch.cap +
      TRUCK_DRIVER_MEALS.dinner.cap
  );

  const taxableIncome = round2(Math.max(0, totalAssessable - totalDeductions));
  const incomeTax = calcMarginalTax(taxableIncome);
  const medicare = calcMedicareLevy(taxableIncome);
  const estimatedTax = round2(incomeTax + medicare);

  const substantiationRequired = totalDeductions > SUBSTANTIATION.totalWorkExpensesReceiptThreshold;

  return {
    financialYear: fyFilter || "all",
    profile: {
      driverType: profile.driverType,
      annualSalary,
      salaryBand,
      travelCaps,
    },
    income: {
      grossTotal: totalGrossIncome,
      assessableTotal: totalAssessable,
      breakdown: Object.values(incomeBreakdown),
    },
    expenses: {
      grossTotal: totalGrossExpenses,
      deductibleTotal: totalDeductions,
      breakdown: Object.values(expenseBreakdown),
    },
    allowances: {
      truckDriverMealsDaily: TRUCK_DRIVER_MEALS,
      overtimeMealCap: OVERTIME_MEAL_CAP,
      maxDailyMealsPotential: mealAllowancePotential,
      domesticTravelCaps: travelCaps,
    },
    taxEstimate: {
      taxableIncome,
      incomeTax,
      medicareLevy: medicare,
      totalTax: estimatedTax,
      effectiveRate: totalAssessable > 0 ? round2((estimatedTax / totalAssessable) * 100) : 0,
    },
    substantiation: {
      required: substantiationRequired,
      threshold: SUBSTANTIATION.totalWorkExpensesReceiptThreshold,
      message: substantiationRequired
        ? "Total work-related deductions exceed $300 — written evidence required for claims."
        : "Keep records for all expenses; written evidence rules may still apply per category.",
    },
    warnings: allWarnings,
  };
}

function buildAccountantReport(records, profile = {}) {
  const summary = summariseYear(records, profile);
  const generatedAt = new Date().toISOString();

  return {
    title: "Line Haulage Driver – Performance & Tax Summary",
    subtitle: `Australian financial year ${summary.financialYear}`,
    generatedAt,
    driver: {
      name: profile.name || "Driver",
      abn: profile.abn || null,
      employer: profile.employer || null,
      driverType: profile.driverType || "long_haul",
      tfnSupplied: Boolean(profile.tfnSupplied),
    },
    disclaimer:
      "Prepared for accountant review. Not tax advice. Verify against current ATO guidance and individual circumstances.",
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

module.exports = {
  calcExpenseDeduction,
  calcIncomeAssessability,
  calcMarginalTax,
  calcMedicareLevy,
  summariseYear,
  buildAccountantReport,
  round2,
};
