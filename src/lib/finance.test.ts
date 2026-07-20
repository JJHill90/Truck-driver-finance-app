import { describe, expect, it } from 'vitest'
import {
  computeTotals,
  createId,
  expensesByCategory,
  formatCurrency,
  type Transaction,
} from './finance'

const sample: Transaction[] = [
  {
    id: '1',
    type: 'income',
    category: 'Load / Revenue',
    description: 'Chicago -> Dallas load',
    amount: 2400,
    date: '2026-07-01',
  },
  {
    id: '2',
    type: 'expense',
    category: 'Fuel',
    description: 'Diesel top-up',
    amount: 650.5,
    date: '2026-07-02',
  },
  {
    id: '3',
    type: 'expense',
    category: 'Tolls',
    description: 'I-90 tolls',
    amount: 49.5,
    date: '2026-07-02',
  },
  {
    id: '4',
    type: 'expense',
    category: 'Fuel',
    description: 'Diesel top-up 2',
    amount: 300,
    date: '2026-07-03',
  },
]

describe('computeTotals', () => {
  it('returns zeroes for an empty ledger', () => {
    expect(computeTotals([])).toEqual({ income: 0, expenses: 0, net: 0 })
  })

  it('sums income, expenses and net earnings', () => {
    const totals = computeTotals(sample)
    expect(totals.income).toBe(2400)
    expect(totals.expenses).toBe(1000)
    expect(totals.net).toBe(1400)
  })
})

describe('expensesByCategory', () => {
  it('aggregates expenses per category, largest first', () => {
    const result = expensesByCategory(sample)
    expect(result).toEqual([
      { category: 'Fuel', total: 950.5 },
      { category: 'Tolls', total: 49.5 },
    ])
  })

  it('ignores income transactions', () => {
    const incomeOnly: Transaction[] = [sample[0]]
    expect(expensesByCategory(incomeOnly)).toEqual([])
  })
})

describe('formatCurrency', () => {
  it('formats numbers as USD', () => {
    expect(formatCurrency(1400)).toBe('$1,400.00')
    expect(formatCurrency(-50.5)).toBe('-$50.50')
  })
})

describe('createId', () => {
  it('produces unique ids', () => {
    const a = createId()
    const b = createId()
    expect(a).not.toBe(b)
  })
})
