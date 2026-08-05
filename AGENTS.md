# AGENTS.md

## Project overview

**Haulage Finance** (repo `Truck-driver-finance-app`) is a finance tool for
Australian truck drivers: work expenses, income/remittances, receipt/payslip
OCR, a live EOFY report, tax estimate and forecast. Standard commands (`start`,
`dev`, `lint`, `test`) are in `README.md`.

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
- **Title screen gate.** `#title-screen` covers the app until `/auth/me` has a
  user; `body.auth-locked` hides `.app-shell`. Login/register on the title form
  (same `/auth/*` APIs) then reload into the main menu. Logout returns to the
  title screen. Branding is **Haulage Finance** (Figtree + Barlow Condensed,
  same navy/amber palette).
- **Profile licence class.** Profile “Licence class” is LR/MR → HR → HC → MC
  from annual salary (`lib/licence-class.js`: ≥$70k HR, ≥$79k HC, ≥$110k MC).
  Auto-updates as salary is typed; saved as `profile.licenceClass`. This is
  separate from ATO travel **salary bands** (band1/2/3), which the tax
  calculator still derives from salary for allowance caps.
- **Allowance caps (dashboard).** Band-1 daily stack is **$328.90** =
  meals $128 + overtime meal $38.65 + accommodation $138 + incidentals $24.25
  (TD 2025/4; higher bands raise accommodation/meals/incidentals). UI in
  `enhancements.js` + `lib/allowance-tally.js` shows grand total, roaming
  segment spend (breakfast/lunch/dinner/food/OT/accom/incidentals), and a
  day/week/month selector with per-day breakdown. Resets at midnight AEST.
- **Living Away from Home (LAFHA) boxes.** Dashboard + Income panels
  (`#dashboard-lafha-box`, `#income-lafha-box`) via `GET /lafha` /
  `lib/lafha.js`: ATO truck-driver overnight meal rate **$128/day**, salary
  band from profile annual salary (or estimated from payslips), and paid
  Travel/LAFHA lines detected on income. Income menu includes
  “Living Away from Home / Travel allowance”.
- The API is mounted at `/api/haulage/*`; `public/app.js` hardcodes that base as
  `${window.location.origin}/api/haulage`, so open the UI via the server (not a
  `file://`) on the same origin as the API. If `fetch` fails, app.js’s default
  toast says “start the server (npm start)…” — `enhancements.js` intercepts
  `/api/haulage` network failures, retries once (~1.5s, helps hosted cold starts),
  and surfaces a connection/wake-up message on non-localhost hosts instead.
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
- **Email + recovery + password age.** Self-register requires an email and a
  password that passes `lib/password-strength.js` (fair/strong). Profile can
  update email / change password. Missing email and passwords older than 90 days
  appear in `/alerts`. After 10 failed logins (or “Forgot username / password?”),
  `POST /auth/recover/request` emails a link to `/haulage/recover.html` (reveals
  username + set new password). SMTP optional via `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_BASE_URL`. Without SMTP the API
  returns a same-origin `recoveryUrl` and the title-screen UI shows
  “Continue to reset password” (not an error).
- **Primary mod admin:** bootstraps `Haulage_Admin` / `Haulage_Admin` on startup
 via `auth.ensureAdminBootstrap()` (override with `HAULAGE_ADMIN_USERNAME` /
 `HAULAGE_ADMIN_PASSWORD`). Admin-only routes: `GET /admin/users`,
 `POST /admin/users` (create driver profile), `DELETE /admin/users/:username`
 (wipe account + records + receipt files; cannot delete primary mod),
 `GET /admin/users/:username`, `GET /admin/users/:username/receipts/:id/file`.
 Profile tab shows the admin panel via `enhancements.js` when `user.isAdmin`.
 Opening another user is read-only and does not switch your signed-in session.
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
- **Scanned / image-only PDFs** (a photo or scan saved as a PDF, no text layer)
 are OCR'd via `lib/pdf-ocr.js`: it rasterises pages with **`mupdf`** and reruns
 the provided `extractTotalsWithTesseract`. `server.js` `/receipts/scan` calls
 this fallback only when the PDF text layer yields no dollar total
 (`pdfResultNeedsOcr`), for both expense and income docs. Note `mupdf` is an
 **ESM-only** package with top-level await, so this CommonJS repo loads it via
 dynamic `import()` (lazy, cached) — do not `require()` it. No native build is
 needed (pure WASM), so it runs on Render as-is.
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
- **Render deploy branch must be `main`.** Service `haulage-finance`
  (`srv-d9ga1gernols73c55bm0`) auto-deploys on commit. There is one shared app
  build for admin and every driver profile (per-user data only differs under
  `data/users/`). If the dashboard Production Branch is left on an old
  `cursor/…` feature branch, merges to `main` will not reach users — switch the
  branch back to `main` and redeploy.
- **Duplicate scan guard:** `/receipts/scan` runs OCR then
  `lib/duplicate-receipt.js` matches existing expenses/income/receipts on
  **date + vendor + amount**. If matches exist and `forceDuplicate` is not set,
  the API returns `possibleDuplicate` without saving. `enhancements.js` shows
  “possible duplicate detected, do you wish to continue with the upload?” —
  Cancel returns 409 to `app.js`; Continue re-posts with `forceDuplicate: true`.
- **Expenses tab** includes the former Scan receipt flow (upload, approve
  totals, manual entry with ABN, receipt gallery) plus expense totals,
  **Car Expenses/Claims** (ATO D1 cents/km or logbook, plus fuel / repairs /
  tyres / rego–insurance / parking–tolls via `listSpecialClaimCategories`), and
  the expense ledger. The general expense menus hide the whole **Vehicle & fuel**
  group (car claims only via Car Expenses/Claims) and show a **Medical** group
  containing Medical equipment (`compulsory_assessment`). Nav no longer has a
  separate Scan receipt item; `setView("receipts")` redirects to `expenses`.
- **Expense scan approval:** when OCR finds multiple line amounts, only the
  overall/grand total (or largest amount if unlabeled) is primary. The confirm
  UI asks to approve that single total — other line amounts are informational
  and do not need adjusting before save. Income scans still show multi-field
  amounts (gross/net/etc.).
- **ABN + vendor memory.** Scans use `lib/vendor-enrichment.js`: ABN is the key
  reference to remembered business names. Once ABN/name establish a known
  **business type** (e.g. Woolworths/Coles/ALDI → `groceries_travel`, Bunnings →
  `tools_equipment`), that category always overrides weak OCR (`other_work`) and
  conflicting remembered defaults. Otherwise vendor memory + text heuristics apply.
  **Canonical chain names:** after OCR, enrichment rewrites junk/boilerplate
  vendor strings (e.g. `TAX INVOICE`, `7 EIEVEN`, random letters) to clean names
  like `7-Eleven` when the brand appears in the vendor field or receipt header —
  without editing the verbatim OCR modules. Plausible independent names are left
  alone.
- **Expense period filter (no visual tag).** Rows outside the selected
  day/week/month/year still get `out-of-period` and stay out of period totals;
  `enhancements.js` removes the “outside period” label so the ledger stays clean.
- **Ledger edit + period filter.** Expense/income rows get an **Edit** button
  (beside Delete) that opens a modal and `PUT /expenses/:id` or `PUT /income/:id`
  via `lib/ledger-edit.js` (receipt links preserved). Expense ledger + expense
  receipt gallery filter by **week** (Mon–Sun labels like `27/07 – 02/08`) next
  to the FY dropdown (`localStorage` `haulage-ledger-week-*` /
  `haulage-gallery-week-*`); income ledger still uses a month dropdown
  (`haulage-ledger-month-*`). “All weeks” keeps full-year search.
  On each new **Monday** (local time), `enhancements.js` registers an empty week
  slot (`haulage-started-weeks`), sets `haulage-active-week-start`, points expense
  filters at that week, and toasts — no blank expense row is invented.
- **Expense scan totals.** Photo/PDF scans prefer amounts linked to **TOTAL** /
  **SALE TOTAL** (and grand/amount due) via `lib/expense-total.js`, so card
  tenders (VISA/EFT) and line items do not become the approved total.
- **AU dates → FY.** Scans resolve the document date via `lib/aus-date.js`:
  `DD/MM/YYYY` is day/month (so `08/05/2026` → `2026-05-08` → FY **2025-26**).
  Labeled invoice/payment dates beat a leading YTD/period-start date that local
  OCR often grabs first. Confirm/save payloads are coerced the same way.
  Document years are clamped to **today − 20 … today + 1**; two-digit years
  outside that window (e.g. OCR `70` → 2070) are rejected so far-future FYs
  are not created — the confirm date then falls back empty/today.
- **Login required to write.** Guests (no session) get `403` on mutating API
  routes — sign in on the Profile tab first. Any signed-in profile can add/edit
  their own data; admin-only routes (`/admin/*`) still require `Haulage_Admin`.
  Open without login: `GET`s, `/auth/login`, `/auth/logout`, `/auth/register`,
  and `/expenses/preview`.
- **Uploads require login.** `/receipts/scan`, `/receipts/manual`, and
  `/receipts/:id/confirm` return 401 if there is no session — files save into
  `data/users/<name>.json` + `data/receipts/`. Receipts store `purpose`
  (`expense`|`income`); expense/income galleries filter by purpose. Duplicate
  matching is also purpose-scoped so an expense receipt does not block a
  payslip upload.
