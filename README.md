# Truck-driver-finance-app

**TruckLedger** — a lightweight finance tracker for truck drivers to log loads,
fuel, tolls and other expenses, and instantly see net earnings on the road.

Built with **Vite + React + TypeScript**. Transactions are persisted locally in
the browser via `localStorage`, so the app runs fully client-side with no
backend required.

## Requirements

- Node.js 20+ (developed on Node 22)
- npm 10+

## Getting started

```bash
npm install      # install dependencies
npm run dev      # start the dev server at http://localhost:5173
```

## Scripts

| Command             | Description                                     |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Start the Vite dev server (HMR) on port `5173`. |
| `npm run build`     | Type-check and build the production bundle.     |
| `npm run preview`   | Preview the production build locally.           |
| `npm run lint`      | Run ESLint over the project.                    |
| `npm test`          | Run the unit/component test suite (Vitest).     |
| `npm run test:watch`| Run tests in watch mode.                        |

## Project structure

```
src/
  App.tsx              # Main UI: add transactions, summary cards, ledger
  App.test.tsx         # Component tests (Testing Library + Vitest)
  lib/
    finance.ts         # Pure domain logic (totals, categories, formatting)
    finance.test.ts     # Unit tests for domain logic
    useLocalStorage.ts # Persistence hook
  test/setup.ts        # Test environment setup (jest-dom matchers)
```

## Deployment

Configured for Netlify (see `netlify.toml`): build command `npm run build`,
publish directory `dist`, with an SPA fallback redirect.
