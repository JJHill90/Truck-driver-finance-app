import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

beforeEach(() => {
  window.localStorage.clear()
})

describe('<App />', () => {
  it('shows an empty ledger initially', () => {
    render(<App />)
    expect(screen.getByText(/No transactions yet/i)).toBeInTheDocument()
    expect(screen.getByTestId('net-value')).toHaveTextContent('$0.00')
  })

  it('adds an income transaction and updates the net total', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(
      screen.getByPlaceholderText(/Chicago/i),
      'Chicago to Dallas load',
    )
    await user.type(screen.getByPlaceholderText('0.00'), '2400')
    await user.click(screen.getByRole('button', { name: /Add transaction/i }))

    expect(screen.getByText('Chicago to Dallas load')).toBeInTheDocument()
    expect(screen.getByTestId('net-value')).toHaveTextContent('$2,400.00')
  })

  it('validates that an amount is required', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByPlaceholderText(/Chicago/i), 'Missing amount')
    await user.click(screen.getByRole('button', { name: /Add transaction/i }))

    expect(
      screen.getByText(/Enter an amount greater than zero/i),
    ).toBeInTheDocument()
  })
})
