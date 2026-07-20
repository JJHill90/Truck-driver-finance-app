export type TransactionType = 'income' | 'expense'

export type Category =
  | 'Load / Revenue'
  | 'Fuel'
  | 'Tolls'
  | 'Maintenance'
  | 'Insurance'
  | 'Meals'
  | 'Other'

export interface Transaction {
  id: string
  type: TransactionType
  category: Category
  description: string
  amount: number
  date: string // ISO date (YYYY-MM-DD)
}

export const INCOME_CATEGORIES: Category[] = ['Load / Revenue', 'Other']

export const EXPENSE_CATEGORIES: Category[] = [
  'Fuel',
  'Tolls',
  'Maintenance',
  'Insurance',
  'Meals',
  'Other',
]

export interface Totals {
  income: number
  expenses: number
  net: number
}

/** Sum revenue, expenses and net earnings across all transactions. */
export function computeTotals(transactions: Transaction[]): Totals {
  return transactions.reduce<Totals>(
    (acc, t) => {
      if (t.type === 'income') {
        acc.income += t.amount
      } else {
        acc.expenses += t.amount
      }
      acc.net = acc.income - acc.expenses
      return acc
    },
    { income: 0, expenses: 0, net: 0 },
  )
}

/** Group expense totals by category, sorted from largest to smallest. */
export function expensesByCategory(
  transactions: Transaction[],
): Array<{ category: Category; total: number }> {
  const map = new Map<Category, number>()
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    map.set(t.category, (map.get(t.category) ?? 0) + t.amount)
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

let counter = 0
/** Generate a reasonably unique id without external deps. */
export function createId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}
