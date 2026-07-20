# AGENTS.md

## Project overview

**Haulage** (repo `Truck-driver-finance-app`) is a finance tool for Australian
truck drivers: work expenses, income/remittances, receipt/payslip OCR, a live
EOFY report, tax estimate and forecast. Standard commands (`start`, `dev`,
`lint`, `test`) are in `README.md`.

- Frontend: framework-free SPA in `public/app.js` (provided verbatim). The
  backend + `public/index.html` exist to satisfy the exact DOM ids and API
  contract it expects.
- Backend: Node.js + Express (`server.js`, CommonJS). The domain logic in `lib/`
  (ATO standards, tax calculator, forecast, storage, OCR pipeline) is provided
  verbatim — treat those files as source-of-truth and avoid editing them.

## Cursor Cloud specific instructions

- Single service. Start with `npm start` (or `npm run dev` for `node --watch`).
  Listens on port `3000` bound to `0.0.0.0`; open the UI at
  **`http://localhost:3000/haulage/`** (root `/` 302-redirects there). `PORT`
  overrides the port.
- The API is mounted at `/api/haulage/*`; `public/app.js` hardcodes that base as
  `${window.location.origin}/api/haulage`, so open the UI via the server (not a
  `file://`) on the same origin as the API.
- This project is **CommonJS** (no `"type": "module"` in `package.json`); the
  provided `lib/` modules use `require`/`module.exports`. Keep new server code
  CommonJS.
- Persistence is a local JSON file at `data/driver-records.json` with receipt
  uploads under `data/receipts/` (both git-ignored). `server.js` loads records
  once into memory at boot and calls `storage.saveRecords` after each mutation —
  so editing the JSON while the server runs has no effect until restart, and to
  fully reset app data you stop the server, delete `data/`, and restart.
- Receipt/payslip OCR: local **Tesseract.js** runs for images by default (its
  worker lazily downloads the `eng` model on first real scan; if that fails or
  the image is trivial, it gracefully falls back to a demo/manual result). Set
  `OPENAI_API_KEY` to enable cloud OCR (`gpt-4o-mini`), which is merged with the
  local result. PDF income docs use `pdf-parse`. All three (`tesseract.js`,
  `openai`, `pdf-parse`) are installed by `npm install`; `require('./lib/receipt-ocr')`
  pulls in `tesseract.js` at load, so it must remain installed for the server to boot.
- Lint/tests cover first-party code only: `public/app.js` and the provided
  `lib/*.js` modules are excluded from ESLint (see `eslint.config.js`).
  `npm test` (Vitest, `globals: true`) targets `tax-calculator.test.js`, which
  exercises the real `lib/tax-calculator.js` + `lib/forecast.js`. There is no
  build step.
