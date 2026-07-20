# AGENTS.md

## Project overview

**TruckLedger** (repo `Truck-driver-finance-app`) is a client-side finance
tracker for truck drivers, built with Vite + React + TypeScript. There is no
backend — transactions persist to the browser's `localStorage`. All standard
commands are documented in `README.md` (`dev`, `build`, `preview`, `lint`,
`test`).

## Cursor Cloud specific instructions

- Single service, no backend/database. The only long-running process is the
  Vite dev server (`npm run dev`), served on port `5173` (bound to `0.0.0.0`
  via `server.host` in `vite.config.ts`).
- Domain logic lives in `src/lib/finance.ts` and is intentionally kept pure so
  it can be unit-tested without a DOM. UI/component tests use Testing Library
  with a `jsdom` environment; the matcher setup is in `src/test/setup.ts` and
  wired via `test.setupFiles` in `vite.config.ts`.
- `npm run build` runs `tsc -b` (project references in `tsconfig.app.json` /
  `tsconfig.node.json`) before `vite build`; a type error fails the build even
  if the dev server runs fine.
- App state is persisted under the `localStorage` key
  `truckledger.transactions`. To reset to an empty ledger during manual
  testing, clear site data / that key rather than editing code.
