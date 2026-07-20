import { useMemo, useState } from 'react'
import './App.css'
import {
  computeTotals,
  createId,
  EXPENSE_CATEGORIES,
  expensesByCategory,
  formatCurrency,
  INCOME_CATEGORIES,
  type Category,
  type Transaction,
  type TransactionType,
} from './lib/finance'
import { useLocalStorage } from './lib/useLocalStorage'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function App() {
  const [transactions, setTransactions] = useLocalStorage<Transaction[]>(
    'truckledger.transactions',
    [],
  )

  const [type, setType] = useState<TransactionType>('income')
  const [category, setCategory] = useState<Category>('Load / Revenue')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [error, setError] = useState<string | null>(null)

  const totals = useMemo(() => computeTotals(transactions), [transactions])
  const byCategory = useMemo(
    () => expensesByCategory(transactions),
    [transactions],
  )

  const categoryOptions =
    type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  function onTypeChange(next: TransactionType) {
    setType(next)
    setCategory(next === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0])
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = Number(amount)
    if (!description.trim()) {
      setError('Please add a short description.')
      return
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setError(null)
    const entry: Transaction = {
      id: createId(),
      type,
      category,
      description: description.trim(),
      amount: Math.round(parsed * 100) / 100,
      date,
    }
    setTransactions((prev) => [entry, ...prev])
    setDescription('')
    setAmount('')
  }

  function removeTransaction(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <img src="/truck.svg" alt="" className="brand__logo" />
          <div>
            <h1>TruckLedger</h1>
            <p className="brand__tag">Know your net earnings on the road</p>
          </div>
        </div>
      </header>

      <main className="app__main">
        <section className="summary" aria-label="Summary">
          <div className="card card--income">
            <span className="card__label">Revenue</span>
            <span className="card__value">{formatCurrency(totals.income)}</span>
          </div>
          <div className="card card--expense">
            <span className="card__label">Expenses</span>
            <span className="card__value">
              {formatCurrency(totals.expenses)}
            </span>
          </div>
          <div
            className={`card card--net ${
              totals.net >= 0 ? 'is-positive' : 'is-negative'
            }`}
          >
            <span className="card__label">Net</span>
            <span className="card__value" data-testid="net-value">
              {formatCurrency(totals.net)}
            </span>
          </div>
        </section>

        <div className="layout">
          <section className="panel" aria-label="Add transaction">
            <h2>Add a transaction</h2>
            <form className="form" onSubmit={handleSubmit}>
              <div className="toggle" role="group" aria-label="Transaction type">
                <button
                  type="button"
                  className={type === 'income' ? 'is-active' : ''}
                  onClick={() => onTypeChange('income')}
                >
                  Income
                </button>
                <button
                  type="button"
                  className={type === 'expense' ? 'is-active' : ''}
                  onClick={() => onTypeChange('expense')}
                >
                  Expense
                </button>
              </div>

              <label className="field">
                <span>Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                >
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Description</span>
                <input
                  type="text"
                  value={description}
                  placeholder="e.g. Chicago → Dallas load"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Amount (USD)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    placeholder="0.00"
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>

              {error && <p className="form__error">{error}</p>}

              <button type="submit" className="btn-primary">
                Add transaction
              </button>
            </form>

            {byCategory.length > 0 && (
              <div className="breakdown">
                <h3>Expenses by category</h3>
                <ul>
                  {byCategory.map((row) => (
                    <li key={row.category}>
                      <span>{row.category}</span>
                      <span>{formatCurrency(row.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="panel" aria-label="Transactions">
            <h2>Ledger</h2>
            {transactions.length === 0 ? (
              <p className="empty">
                No transactions yet. Add your first load or expense to get
                started.
              </p>
            ) : (
              <ul className="ledger">
                {transactions.map((t) => (
                  <li key={t.id} className="ledger__item">
                    <div className="ledger__meta">
                      <span className="ledger__desc">{t.description}</span>
                      <span className="ledger__sub">
                        {t.category} · {t.date}
                      </span>
                    </div>
                    <span
                      className={`ledger__amount ${
                        t.type === 'income' ? 'is-income' : 'is-expense'
                      }`}
                    >
                      {t.type === 'income' ? '+' : '−'}
                      {formatCurrency(t.amount)}
                    </span>
                    <button
                      type="button"
                      className="ledger__remove"
                      aria-label={`Delete ${t.description}`}
                      onClick={() => removeTransaction(t.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
