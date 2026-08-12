# AGENTS.md

## Project overview

**Driver Hub** (repo `Truck-driver-finance-app`) is the login hub for driver apps.
The tax product inside it is **Taxation Hub** (formerly Finance Hub / Haulage
Finance): consolidates tax services for drivers — work expenses,
income/remittances, receipt/payslip OCR, a live EOFY report, tax estimate and
forecast. Standard commands (`start`, `dev`, `lint`, `test`) are in `README.md`.

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
- **CORS (Play / iOS).** Same-origin web needs no CORS. For cross-origin store
  shells, set `CORS_ORIGINS` (comma-separated) and/or `CORS_ALLOW_CAPACITOR=1`
  (`lib/cors.js`). Allowlisted origins get credentialed ACAO headers; session
  cookies use `SameSite=None; Secure` on those cross-origin requests. Do not
  use `*` with cookies.
- **Driver Hub gate.** `#title-screen` is the Driver Hub login. After `/auth/me`
  has a user, show the app picker (`#title-hub-picker`) unless
  `localStorage.driverhub-selected-app === "taxationhub"` (legacy `financehub`
  is migrated). Choosing Taxation Hub unlocks `.app-shell` (sidebar brand
  **TaxationHub**). WIP apps stay on the picker lists **Diary Hub** as work in
  progress (work diary / mandatory AU logbook — not available at Taxation Hub
  release). `body.auth-locked` hides the shell. Logout clears the selected app
  and returns to Driver Hub login. Brand wordmarks use Saira Condensed with a
  sky Hub accent (navy/amber UI palette).
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
- Persistence is per-user JSON under `data/users/<name>.json` (plus
  `data/users.json` accounts) with receipt uploads under `data/receipts/` (all
  git-ignored). Writes go through `lib/atomic-write.js` (temp + rename). Guests
  get an empty in-memory shell by default (`ALLOW_GUEST_STORE=1` restores the
  legacy shared `data/driver-records.json`). `server.js` caches records in
  memory and persists after each mutation — editing JSON on disk while the
  server runs has no effect until restart; to fully reset, stop the server,
  delete `data/`, and restart.
- **Auth abuse controls.** `lib/rate-limit.js` rate-limits login/register/
  recover/support POSTs. After 10 failed logins the account is **hard-locked**
  (correct password refused) until `AUTH_LOCKOUT_MS` (default 30 min) expires,
  recovery reset, or primary mod clears failed logins.
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
  `GET /admin/users/:username` (`?includeDeleted=1` for soft-deleted ledger
  rows), `GET /admin/users/:username/receipts/:id/file`, plus ledger overrides
  `POST /admin/users/:username/{expenses|income}/unreconcile|restore|soft-delete`.
  Profile tab shows the admin panel via `enhancements.js` when `user.isAdmin`.
  Opening another user is read-only and does not switch your signed-in session;
  the detail view can unlock reconciliations and restore accidental deletes.
- **Ledger reconcile.** Expense and income ledgers get a select-all column and
  per-row checkboxes. When any open row is ticked, **Reconcile entries** appears
  in the ledger header — `POST /expenses/reconcile` or `POST /income/reconcile`
  (`lib/ledger-lifecycle.js`) locks those rows (`reconciled` / `reconciledAt` /
  `reconciledBy`). Reconciled rows cannot be edited or deleted by the driver.
  Deletes are soft (`deletedAt` / `deletedBy`) so tax/summary views use
  `withActiveLedger`; Haulage_Admin can restore or force-remove via the admin
  panel.
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
- **Full-store backups.** `lib/backup.js` writes daily `.tar.gz` archives of
  accounts, per-user JSON, receipts, history and support messages to
  `data/backups/` (keeps `BACKUP_KEEP`, default 14). Clock-aligned scheduler
  defaults to **17:00 Australia/Sydney** (`BACKUP_AT`, `BACKUP_TIMEZONE`); if
  the process was down at 5pm it catch-ups once later that day. Flushes the
  in-memory records cache before each run. Primary mod can list / download /
  run now / restore from Profile → admin panel; with the admin panel open
  around 5pm, today’s archive auto-downloads once to that browser. Restore
  requires `confirm: "RESTORE"` and takes a safety backup first. Optional
  off-site: `BACKUP_OFFSITE_DIR` and/or `BACKUP_S3_BUCKET` + AWS credentials;
  optional notify via `BACKUP_NOTIFY_EMAIL` / `SUPPORT_EMAIL` when mail is
  configured. Hands-off off-site copy: GitHub Action
  `.github/workflows/daily-backup.yml` (+ secrets `HAULAGE_BASE_URL`,
  `HAULAGE_ADMIN_USERNAME`, `HAULAGE_ADMIN_PASSWORD`) archives to Actions
  artifacts at 5pm Sydney; optional S3 still available.
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
- **Expenses tab** has two sub-tabs: **General Expenses and Claims**
  (scan/manual, totals, general receipt gallery + ledger) and **Car Expenses
  and Claims** (ATO D1 cents/km or logbook, plus fuel / repairs / tyres /
  rego–insurance / parking–tolls via `listSpecialClaimCategories`, with its own
  car receipt gallery + car ledger).
  Car rows stay in the same `expenses` store; the UI filters by car category
  ids. The general expense menus hide the whole **Vehicle & fuel** group (car
  claims only via the Car tab) and show a **Medical** group containing Medical
  equipment (`compulsory_assessment`). Nav no longer has a separate Scan
  receipt item; `setView("receipts")` redirects to `expenses`.
- **Expense scan approval:** when OCR finds multiple line amounts, only the
  overall/grand total (or largest amount if unlabeled) is primary. The confirm
  UI asks to approve that single total — other line amounts are informational
  and do not need adjusting before save. Income scans still show multi-field
  amounts (gross/net/etc.).
- **ABN + vendor memory.** After OCR, `lib/abn-entity.js` picks the best
  checksum-valid ABN with the entity/vendor name attached to it (prefers
  supplier/employer ABNs near the business header; demotes customer/buyer ABNs)
  for both expense receipts and income payslips/invoices, then
  `lib/vendor-enrichment.js` uses that ABN as the key to remembered business
  names. Once ABN/name establish a known **business type** (e.g.
  Woolworths/Coles/ALDI → `groceries_travel`, Bunnings → `tools_equipment`),
  that category always overrides weak OCR (`other_work`) and conflicting
  remembered defaults. Otherwise vendor memory + text heuristics apply.
  Confirm UI prefills vendor/entity, ABN, and the dollar total together.
  Income confirm gets an ABN field via `enhancements.js`.
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
  via `lib/ledger-edit.js` (receipt links preserved). Edit/Delete are disabled
  once a row is reconciled. Expense ledger + expense receipt gallery filter by
  **week** (Mon–Sun labels like `27/07 – 02/08`) next to the FY dropdown
  (`localStorage` `haulage-ledger-week-*` / `haulage-gallery-week-*`); income
  ledger still uses a month dropdown (`haulage-ledger-month-*`). “All weeks”
  keeps full-year search. On each new **Monday** (local time), `enhancements.js`
  registers an empty week slot (`haulage-started-weeks`), sets
  `haulage-active-week-start`, points expense filters at that week, and toasts —
  no blank expense row is invented.
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
- **FY picker window (6 past / 3 future).** Top-bar / Profile / ledger FY
  dropdowns show **6 past + current + 3 future** Australian financial years
  (`lib/fy-window.js`; `enhancements.js` overrides verbatim `app.js` which
  still builds a wider ±15/20 list). The window is relative to today and
  slides automatically each 1 July — no manual year catalog. A selected FY
  outside the window stays listed so an existing profile year is not lost.
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
- **Support tab** (sidebar bottom-left): contact form posts to
 `POST /api/haulage/support/contact` (open to guests). Messages persist in
 `data/support-messages.json`. Delivery order in `lib/mail.js`: **SMTP**
 (`SMTP_HOST` + `MAIL_FROM` + usually `SMTP_USER`/`SMTP_PASS`) → **Resend**
 (`RESEND_API_KEY`). On success the developer inbox
 (`SUPPORT_EMAIL` / `hilljj1990@gmail.com`) gets the enquiry and the user
 gets a confirmation email. If neither channel is configured, the UI delivers
 via **FormSubmit** in the browser (first use may require the inbox owner to
 click FormSubmit’s activation email). Help blurbs live in
 `public/enhancements.js`.
- **Version label** sits under the Support button (sidebar bottom-left) and on
 the title/login screen. Source: `lib/version.js` / `GET /api/haulage/version`.
 Bump `HAULAGE_PR_NUMBER` with each new PR. Display rules: PR *n* →
 `Version .(n mod 50)` (e.g. PR 49 → `Version .49`); every 50th PR →
 `Version X.0` (PR 50 → `Version 1.0`, PR 100 → `Version 2.0`), then the
 `.1`…`.49` cycle restarts.
