import { describe, expect, it } from 'vitest'
import {
  analyzeExpense,
  buildForecast,
  buildReport,
  currentFinancialYear,
  incomeTax,
  parseFinancialYear,
  summarize,
} from './tax.js'

describe('incomeTax', () => {
  it('is zero under the tax-free threshold', () => {
    expect(incomeTax(18200)).toBe(0)
  })
  it('applies the 16% bracket', () => {
    expect(incomeTax(45000)).toBeCloseTo(4288, 0)
  })
  it('applies higher brackets', () => {
    expect(incomeTax(135000)).toBeCloseTo(31288, 0)
    expect(incomeTax(200000)).toBeCloseTo(56138, 0)
  })
})

describe('analyzeExpense', () => {
  it('applies work-use percentage', () => {
    const r = analyzeExpense({ amount: 100, workUsePercent: 80, category: 'phone' })
    expect(r.deductibleAmount).toBe(80)
    expect(r.atoSchedule).toBe('D5')
  })
  it('zeroes out reimbursed expenses', () => {
    const r = analyzeExpense({ amount: 100, reimbursed: true })
    expect(r.deductibleAmount).toBe(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
  it('caps cents-per-km car claims at 5000 km', () => {
    const r = analyzeExpense({ category: 'vehicle_car', method: 'cents_per_km', kilometres: 6000 })
    expect(r.grossAmount).toBeCloseTo(4400, 2) // 5000 * 0.88
    expect(r.deductibleAmount).toBeCloseTo(4400, 2)
  })
})

describe('parseFinancialYear', () => {
  it('parses an AU FY range', () => {
    expect(parseFinancialYear('2025-26')).toEqual({
      start: '2025-07-01',
      end: '2026-06-30',
      label: 'FY 2025–26',
    })
  })
  it('returns null for bad input', () => {
    expect(parseFinancialYear('nope')).toBeNull()
  })
})

describe('summarize', () => {
  const store = {
    profile: { salaryBand: 'band1', annualSalary: 90000, financialYear: '2025-26' },
    income: [
      { id: 'i1', date: '2025-08-01', type: 'salary_wages', grossTotal: 90000, taxableIncome: 90000, amount: 70000 },
    ],
    expenses: [
      { id: 'e1', date: '2025-08-02', category: 'fuel', amount: 1000, workUsePercent: 100 },
      { id: 'e2', date: '2024-08-02', category: 'fuel', amount: 5000, workUsePercent: 100 },
    ],
  }

  it('only counts rows inside the selected financial year', () => {
    const s = summarize(store, '2025-26')
    expect(s.income.assessableTotal).toBe(90000)
    expect(s.expenses.deductibleTotal).toBe(1000)
  })

  it('computes taxable income net of deductions', () => {
    const s = summarize(store, '2025-26')
    expect(s.taxEstimate.taxableIncome).toBe(89000)
    expect(s.taxEstimate.totalTax).toBeGreaterThan(0)
  })
})

describe('buildReport', () => {
  it('wraps a summary with report metadata', () => {
    const store = { profile: { name: 'Test Driver', financialYear: '2025-26' }, income: [], expenses: [] }
    const r = buildReport(store, '2025-26')
    expect(r.title).toMatch(/EOFY/i)
    expect(r.driver.name).toBe('Test Driver')
    expect(r.summary.financialYear).toBe('2025-26')
  })
})

describe('buildForecast', () => {
  it('produces projections and three scenarios', () => {
    const store = { profile: { financialYear: currentFinancialYear() }, income: [], expenses: [] }
    const f = buildForecast(store, { mode: 'manual', projectedIncome: 120000, projectedDeductions: 8000 })
    expect(f.projected.income).toBe(120000)
    expect(f.scenarios).toHaveLength(3)
    expect(f.yearProgress.percentComplete).toBeGreaterThanOrEqual(0)
  })
})
