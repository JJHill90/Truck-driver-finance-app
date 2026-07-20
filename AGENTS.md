# AGENTS.md

## Project overview

**Haulage** (repo `Truck-driver-finance-app`) is a finance tool for Australian
truck drivers: work expenses, income/remittances, receipt capture, a live EOFY
report, tax estimate and forecast. Standard commands (`start`, `dev`, `lint`,
`test`) are documented in `README.md`.

- Frontend: framework-free SPA in `public/app.js` (treat as source-of-truth /
  user-provided — the backend and `public/index.html` exist to satisfy the exact
  DOM ids and API contract it expects).
- Backend: Node.js + Express (`server.js`) with pure logic in `lib/` and a
  JSON-file store in `lib/store.js`.

## Cursor Cloud specific instructions

- Single service. Start with `npm start` (or `npm run dev` for `node --watch`).
  It listens on port `3000` bound to `0.0.0.0`; open the UI at
  **`http://localhost:3000/haulage/`** (root `/` 302-redirects there). Set `PORT`
  to override.
- The API is mounted at `/api/haulage/*`; `public/app.js` hardcodes that base as
  `${window.location.origin}/api/haulage`, so the UI must be opened via the
  server (not as a `file://`) and on the same origin as the API.
- Persistence is a local JSON file at `data/store.json` with receipt uploads in
  `data/uploads/` (both git-ignored). To reset all app data, stop the server,
  delete the `data/` directory, and restart — the store is cached in memory, so
  deleting the file while running has no effect until restart.
- Receipt/payslip OCR is intentionally in fallback mode (`ocrResult.ocrSource`
  is `"fallback"`/`"pdf"`, `detectedTotals: []`): files are stored and the user
  enters/approves totals. There is no AI key wired in; adding real OCR means
  implementing it in `POST /api/haulage/receipts/scan`.
- `public/app.js` is deliberately excluded from ESLint (browser globals, provided
  verbatim); lint/tests cover `server.js` and `lib/` only. `npm test` (Vitest)
  targets the pure functions in `lib/tax.js`; there is no build step.
