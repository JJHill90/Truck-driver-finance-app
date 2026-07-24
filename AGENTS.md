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
  `lib/*.js` modules are excluded from ESLint (see `eslint.config.js`); my own
  `lib/document-breakdown.js`, `server.js`, `public/enhancements.js` and the
  `*.test.js` files ARE linted. `npm test` (Vitest, `globals: true`) covers
  `tax-calculator.test.js` and `document-breakdown.test.js`. No build step.
- Multi-user accounts are layered on without editing the provided files.
  `lib/auth.js` stores accounts in `data/users.json` (salted PBKDF2) and holds
  sessions in memory (tokens); `server.js` reads the `haulage_sid` HttpOnly
  cookie, resolves `req.user`, and scopes every route to that user's own records
  file (`data/users/<name>.json`) via a per-user cache — anonymous requests use a
  shared guest store. `public/enhancements.js` renders the Profile-tab account
  panel (register/login/logout/presets) and a missing-data alert banner
  (`GET /alerts`), and reloads the page after an auth change so `app.js`
  re-fetches user-scoped data. Sessions reset on server restart (accounts/data
  persist); receipt image files are shared under `data/receipts/` (UUID names).
- **Primary mod admin:** bootstraps `Haulage_Admin` / `Haulage_Admin` on startup
  via `auth.ensureAdminBootstrap()` (override with `HAULAGE_ADMIN_USERNAME` /
  `HAULAGE_ADMIN_PASSWORD`). Admin-only routes: `GET /admin/users`,
  `GET /admin/users/:username`, `GET /admin/users/:username/receipts/:id/file`.
  Profile tab shows the admin panel via `enhancements.js` when `user.isAdmin`.
  Read-only — does not switch the signed-in session to the other user.
- Scan enrichment is layered on without editing the provided files:
  `lib/document-breakdown.js` computes the typed component breakdown + ATO
  compliance and `server.js` folds it into the `/receipts/scan` response
  (`componentBreakdown`, `compliance`, and typed `detectedTotals`).
  `public/enhancements.js` (loaded after `app.js` in `index.html`) wraps
  `fetch` to capture that response and renders the breakdown/compliance panel
  into the scan-review box, and adds a click-to-enlarge image lightbox. Because
  the provided OCR extractors don't parse super/PAYG as named fields, those
  components are estimated/flagged unless a clear scan or `OPENAI_API_KEY`
  surfaces them — the full breach/within-policy grading is covered by unit tests.
- Scanned expense receipts and income invoices are **labeled on save** as
  `DD.MM.YY AUD$123.45.ext` (image or PDF). `lib/document-label.js` builds the
  name; `/receipts/scan` applies an initial OCR-based label and
  `/receipts/:id/confirm` rewrites it from the approved date/amount (income
  prefers gross). On-disk files stay UUID-named under `data/receipts/`; the
  label is `receipt.filename` (downloads, share, gallery title).
- **Hosted multi-user (Render):** accounts live under `data/` on a **persistent
  disk** (`render.yaml` → `haulage-data` at `/opt/render/project/src/data`).
  Without that disk, every deploy wipes users — the admin list then only shows
  `Haulage_Admin`. Drivers must register on the **same hosted URL**; local
  laptop accounts do not appear on Render.
- **Duplicate scan guard:** `/receipts/scan` runs OCR then
  `lib/duplicate-receipt.js` matches existing expenses/income/receipts on
  **date + vendor + amount**. If matches exist and `forceDuplicate` is not set,
  the API returns `possibleDuplicate` without saving. `enhancements.js` shows
  “possible duplicate detected, do you wish to continue with the upload?” —
  Cancel returns 409 to `app.js`; Continue re-posts with `forceDuplicate: true`.
- **Expenses tab** includes the former Scan receipt flow (upload, approve
  totals, manual entry with ABN, receipt gallery) plus expense totals, special
  claims (km/laundry), and the expense ledger. Nav no longer has a separate
  Scan receipt item; `setView("receipts")` redirects to `expenses`.
- **Expense scan approval:** when OCR finds multiple line amounts, only the
  overall/grand total (or largest amount if unlabeled) is primary. The confirm
  UI asks to approve that single total — other line amounts are informational
  and do not need adjusting before save. Income scans still show multi-field
  amounts (gross/net/etc.).
- **Uploads require login.** `/receipts/scan`, `/receipts/manual`, and
  `/receipts/:id/confirm` return 401 if there is no session — files save into
  `data/users/<name>.json` + `data/receipts/`. Receipts store `purpose`
  (`expense`|`income`); expense/income galleries filter by purpose. Duplicate
  matching is also purpose-scoped so an expense receipt does not block a
  payslip upload.
