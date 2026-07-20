import {
  allowanceCaps,
  atoScheduleFor,
  categoryLabel,
  incomeTypes,
  salaryBandForSalary,
} from './standards.js'

const CENTS_PER_KM_RATE = 0.88 // FY2024-25 cents-per-km rate
const CENTS_PER_KM_MAX = 5000
const LAUNDRY_RATE = 1.0 // $/load, work-only
const LAUNDRY_MIXED_RATE = 0.5 // $/load, mixed personal/work

/** Australian resident income tax (FY2024-25 "stage 3" brackets), Medicare excluded. */
export function incomeTax(taxable) {
  const t = Math.max(0, Number(taxable) || 0)
  if (t <= 18200) return 0
  if (t <= 45000) return (t - 18200) * 0.16
  if (t <= 135000) return 4288 + (t - 45000) * 0.3
  if (t <= 190000) return 31288 + (t - 135000) * 0.37
  return 51638 + (t - 190000) * 0.45
}

export function medicareLevy(taxable) {
  return Math.max(0, Number(taxable) || 0) * 0.02
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * Analyse a single expense payload and return the deductible portion,
 * relevant ATO schedule and any warnings. Pure — safe to unit test.
 */
export function analyzeExpense(payload = {}) {
  const amount = Number(payload.amount) || 0
  const workUse = payload.workUsePercent == null ? 100 : Number(payload.workUsePercent)
  const category = payload.category || 'other_work'
  const warnings = []

  let grossAmount = amount
  let deductibleAmount = amount * (workUse / 100)

  if (payload.reimbursed) {
    deductibleAmount = 0
    warnings.push('Reimbursed amounts are not deductible.')
  } else if (category === 'vehicle_car' && payload.method === 'cents_per_km') {
    const km = Number(payload.kilometres) || 0
    const claimableKm = Math.min(km, CENTS_PER_KM_MAX)
    grossAmount = round2(claimableKm * CENTS_PER_KM_RATE)
    deductibleAmount = grossAmount
    if (km > CENTS_PER_KM_MAX) {
      warnings.push(`Cents-per-km is capped at ${CENTS_PER_KM_MAX} km — extra ${km - CENTS_PER_KM_MAX} km ignored.`)
    }
  } else if (category === 'laundry' && payload.laundryLoads != null && payload.laundryLoads !== '') {
    const loads = Number(payload.laundryLoads) || 0
    const rate = payload.laundryMixed ? LAUNDRY_MIXED_RATE : LAUNDRY_RATE
    grossAmount = round2(loads * rate)
    deductibleAmount = grossAmount
    if (loads * rate > 150) {
      warnings.push('Laundry claims over $150 need written evidence.')
    }
  }

  if (!payload.reimbursed && amount > 300 && !payload.vendor && category !== 'vehicle_car') {
    warnings.push('Claims over $300 should be substantiated with a receipt / vendor.')
  }

  return {
    grossAmount: round2(grossAmount),
    deductibleAmount: round2(Math.max(0, deductibleAmount)),
    atoSchedule: atoScheduleFor(category),
    warnings,
  }
}

export function parseFinancialYear(fy) {
  const m = String(fy || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const startYear = Number(m[1])
  return {
    start: `${startYear}-07-01`,
    end: `${startYear + 1}-06-30`,
    label: `FY ${String(fy).replace('-', '–')}`,
  }
}

export function currentFinancialYear(now = new Date()) {
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

function inFinancialYear(dateStr, range) {
  if (!range) return true
  const d = String(dateStr || '')
  return d >= range.start && d <= range.end
}

function assessableForIncome(row) {
  if (row.taxableIncome != null && row.taxableIncome !== '') return Number(row.taxableIncome)
  if (row.grossTotal != null && row.grossTotal !== '') return Number(row.grossTotal)
  return Number(row.amount) || 0
}

/** Build the summary object consumed by renderStats() / renderReport(). */
export function summarize(store, financialYear) {
  const range = parseFinancialYear(financialYear)
  const profile = store.profile || {}

  const incomeRows = (store.income || []).filter((r) => inFinancialYear(r.date, range))
  const expenseRows = (store.expenses || []).filter((r) => inFinancialYear(r.date, range))

  // Income breakdown grouped by type.
  const incomeByType = new Map()
  for (const row of incomeRows) {
    const type = row.type || 'other_income'
    const bucket = incomeByType.get(type) || { grossTotal: 0, assessableTotal: 0 }
    bucket.grossTotal += Number(row.grossTotal ?? row.amount) || 0
    bucket.assessableTotal += assessableForIncome(row)
    incomeByType.set(type, bucket)
  }
  const incomeBreakdown = [...incomeByType.entries()].map(([type, b]) => ({
    type,
    label: incomeTypes.find((t) => t.id === type)?.label || type.replace(/_/g, ' '),
    grossTotal: round2(b.grossTotal),
    assessableTotal: round2(b.assessableTotal),
  }))
  const incomeGross = round2(incomeBreakdown.reduce((s, b) => s + b.grossTotal, 0))
  const incomeAssessable = round2(incomeBreakdown.reduce((s, b) => s + b.assessableTotal, 0))

  // Expense breakdown grouped by category.
  const expByCat = new Map()
  for (const row of expenseRows) {
    const cat = row.category || 'other_work'
    const analysis = analyzeExpense(row)
    const bucket = expByCat.get(cat) || { grossTotal: 0, deductibleTotal: 0, count: 0 }
    bucket.grossTotal += Number(row.amount) || 0
    bucket.deductibleTotal += analysis.deductibleAmount
    bucket.count += 1
    expByCat.set(cat, bucket)
  }
  const expenseBreakdown = [...expByCat.entries()]
    .map(([category, b]) => ({
      category,
      label: categoryLabel(category),
      atoSchedule: atoScheduleFor(category),
      count: b.count,
      grossTotal: round2(b.grossTotal),
      deductibleTotal: round2(b.deductibleTotal),
    }))
    .sort((a, b) => b.deductibleTotal - a.deductibleTotal)
  const expenseGross = round2(expenseBreakdown.reduce((s, b) => s + b.grossTotal, 0))
  const expenseDeductible = round2(expenseBreakdown.reduce((s, b) => s + b.deductibleTotal, 0))

  const taxableIncome = round2(Math.max(0, incomeAssessable - expenseDeductible))
  const tax = round2(incomeTax(taxableIncome))
  const medicare = round2(medicareLevy(taxableIncome))
  const totalTax = round2(tax + medicare)
  const effectiveRate = incomeAssessable > 0 ? round2((totalTax / incomeAssessable) * 100) : 0

  const salaryBand = profile.salaryBand || salaryBandForSalary(profile.annualSalary)
  const band = allowanceCaps.salaryBands[salaryBand] || allowanceCaps.salaryBands.band1

  const warnings = []
  if (expenseGross > 300 && expenseRows.some((r) => !r.receiptId && !r.vendor)) {
    warnings.push({ message: 'Some expenses over the $300 total lack a receipt or vendor — keep evidence.' })
  }
  if (!incomeRows.length) {
    warnings.push({ message: 'No income recorded for this financial year yet.' })
  }

  return {
    financialYear,
    income: { grossTotal: incomeGross, assessableTotal: incomeAssessable, breakdown: incomeBreakdown },
    expenses: { grossTotal: expenseGross, deductibleTotal: expenseDeductible, breakdown: expenseBreakdown },
    taxEstimate: {
      taxableIncome,
      incomeTax: tax,
      medicareLevy: medicare,
      totalTax,
      effectiveRate,
    },
    allowances: {
      overtimeMealCap: allowanceCaps.overtimeMealCap,
      domesticTravelCaps: allowanceCaps.domesticTravelCaps,
      truckDriverMealsDaily: {
        breakfast: { cap: band.breakfast },
        lunch: { cap: band.lunch },
        dinner: { cap: band.dinner },
      },
    },
    substantiation: {
      message:
        expenseGross > 300
          ? 'Total work expenses exceed $300 — written evidence (receipts) is required.'
          : 'Work expenses are under the $300 written-evidence threshold.',
    },
    warnings,
    profile: { salaryBand },
  }
}

export function buildReport(store, financialYear) {
  const summary = summarize(store, financialYear)
  const profile = store.profile || {}
  const range = parseFinancialYear(financialYear)
  return {
    title: 'EOFY performance statement',
    subtitle: range ? range.label : `FY ${financialYear}`,
    generatedAt: new Date().toISOString(),
    driver: {
      name: profile.name || '',
      driverType: profile.driverType || '',
      employer: profile.employer || '',
    },
    disclaimer:
      'Estimates only — not tax advice. Figures use indicative ATO rates and should be confirmed with a registered tax agent.',
    summary,
  }
}

export function buildForecast(store, { mode = 'realtime', projectedIncome, projectedDeductions } = {}, now = new Date()) {
  const fy = store.profile?.financialYear || currentFinancialYear(now)
  const range = parseFinancialYear(fy)
  const start = range ? new Date(range.start + 'T00:00:00') : new Date(now.getFullYear(), 6, 1)
  const end = range ? new Date(range.end + 'T00:00:00') : new Date(now.getFullYear() + 1, 5, 30)

  const daysTotal = Math.max(1, Math.round((end - start) / 86400000) + 1)
  const daysElapsed = Math.min(daysTotal, Math.max(1, Math.round((now - start) / 86400000) + 1))
  const percentComplete = Math.round((daysElapsed / daysTotal) * 100)

  const summary = summarize(store, fy)
  const ytdIncome = summary.income.assessableTotal
  const ytdDeductions = summary.expenses.deductibleTotal

  const factor = daysTotal / daysElapsed
  let income
  let deductions
  if (mode === 'manual') {
    income = Number(projectedIncome) || 0
    deductions = Number(projectedDeductions) || 0
  } else {
    income = round2(ytdIncome * factor)
    deductions = round2(ytdDeductions * factor)
  }

  const projTaxable = Math.max(0, income - deductions)
  const projTax = round2(incomeTax(projTaxable) + medicareLevy(projTaxable))
  const netAfterTax = round2(income - projTax)

  const scenario = (name, incMul, dedMul) => {
    const inc = round2(income * incMul)
    const ded = round2(deductions * dedMul)
    const taxable = Math.max(0, inc - ded)
    const tax = round2(incomeTax(taxable) + medicareLevy(taxable))
    return { name, projectedIncome: inc, projectedDeductions: ded, projectedTax: tax, projectedNet: round2(inc - tax) }
  }

  return {
    mode,
    financialYear: fy,
    yearProgress: { daysElapsed, daysTotal, percentComplete },
    yearToDate: { income: round2(ytdIncome), deductions: round2(ytdDeductions) },
    projected: {
      income: round2(income),
      deductions: round2(deductions),
      totalTax: projTax,
      netAfterTax,
      averageMonthlyNet: round2(netAfterTax / 12),
    },
    scenarios: [
      scenario('Conservative', 0.9, 1.1),
      scenario('Expected', 1.0, 1.0),
      scenario('Optimistic', 1.12, 0.95),
    ],
  }
}
