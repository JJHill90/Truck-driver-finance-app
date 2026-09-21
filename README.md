# Truck-driver-finance-app

**Driver Hub** is the login hub for driver apps. **Taxation Hub** (inside Driver Hub)
consolidates tax services for Australian truck drivers — track work expenses and
income/remittances, capture receipts, and produce a live EOFY performance
statement, tax estimate and forecast. **Fuel Hub** replaces the former Work in
Progress slot: plan diesel fills from load, trailers, tank capacity and fuel
mass, overlay government-style price bands plus fuel cards, and rank
truck-access stops on NHVR freight corridors (not Apple/Google car shortcuts).
GPS tracking or a driver-entered offline route both work from the same login.
Taxation Hub profiles (name, employer, licence class, driver type, work vehicle,
and registered fuel-class vehicles) are the same Driver Hub identity — Fuel Hub
reads them for combination, duty-cycle L/100 km, and per-truck tank litres
(XN93DX / YN16BQ / YN17BQ or a custom class); they are not copied.

The frontend is a framework-free single-page app (`public/app.js`) served by a
small **Node.js + Express** backend that stores data in a local JSON file
(`data/driver-records.json`) and receipt files under `data/receipts/`. No
database is required.

> **Receipt/payslip OCR:** works out of the box with **local OCR** (Tesseract.js)
> plus a manual approve-totals step. If `OPENAI_API_KEY` is set, cloud OCR
> (OpenAI `gpt-4o-mini` vision) is used and merged with the local result. PDF
> income documents are parsed via `pdf-parse`. No key is required to run.

### Scan enrichment (breakdown + ATO compliance)

When a document is scanned, the total is broken down into typed components and
checked against ATO transport-industry standards:

- **Income (payslip/remittance):** components for Wages/gross, PAYG tax,
  Superannuation, Entitlements/allowances, GST and Net pay; compliance checks for
  the Super Guarantee rate (12% for 2025-26+), PAYG withholding and net
  reconciliation. Undetected components (e.g. super) are estimated and flagged.
- **Expense:** line-item breakdown plus checks for ATO reasonable-amount meal
  caps and the $300 substantiation threshold.

For income documents the **pay period and payment date** are extracted (e.g.
"Pay Period From: 17/06/2026 To: 23/06/2026", "Payment Date: 25/06/2026"), the
weekly cycle window it falls into is derived (e.g. Wed→Tue), and all of it is
shown in the review panel and saved with the entry so it appears in filing.

For linehaul drivers the breakdown also adds a separate **Living Away from Home /
Driver Daily Allowance** line — the exact ATO reasonable daily meal amount for
employee truck drivers (TD 2025/4: $31.15 + $35.55 + $61.30 = **$128.00/day**,
sourced from `ato-standards.js`) × days in the pay period. It is shown whether
or not the payslip lists a "Travel Allowance", as a clearly-badged estimate
(meals only, excludes accommodation) that is not counted as actual income.

The scanned image is shown during review and can be clicked to enlarge (a
lightbox) so totals are easy to read before approving. This enrichment lives in
`lib/document-breakdown.js` (backend) and `public/enhancements.js` (UI layer),
leaving the provided `app.js` untouched.

## Requirements

- Node.js 20+ (developed on Node 22)
- npm 10+

## Getting started

```bash
npm install
npm start
```

Then open **http://localhost:3000/haulage/** (the root path `/` redirects there).
**Go Taxation Suite** (general PAYG / sole trader / partnership, same tabs as Taxation Hub) is at **http://localhost:3000/suite/**.
To mimic the dedicated Render host locally: `APP_PRODUCT=suite npm start` — root `/` then redirects to `/suite/`.

## Scripts

| Command          | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `npm start`      | Start the Express server + UI on port `3000`.                |
| `npm run dev`    | Same, with `node --watch` auto-restart on file changes.      |
| `npm run lint`   | Run ESLint over server/lib code.                             |
| `npm test`       | Run backend unit tests (Vitest) for the tax/analysis logic.  |

## Project structure

```
server.js               Express app: static UI + JSON API under /api/haulage
tax-calculator.test.js  Unit tests for the ATO tax/deduction logic
lib/                    Provided backend modules (verbatim):
  ato-standards.js      ATO categories, income types, caps, FY helpers
  tax-calculator.js     Tax brackets, deduction analysis, year summary/report
  forecast.js           EOFY projection + scenarios
  storage.js            JSON-file store + receipt image persistence
  receipt-ocr.js        OCR orchestration (OpenAI + local + merge)
  local-receipt-ocr.js  Tesseract.js money/text extraction
  income-document-ocr.js Payslip/remittance + PDF parsing
  receipt-ocr-money.js  Money parsing helpers
lib/suite/              Go Taxation Suite (general ATO, first-party):
  ato.js                PAYG / sole trader / partnership categories & rates
  tax.js                EOFY summary without truck-driver determinations
  breakdown.js          Scan compliance without LAFHA truck estimates
lib/ (Fuel Hub, first-party):
  fuel-nhvr.js          Heavy-vehicle combinations, mass schemes, freight corridors
  fuel-prices.js        Government-style diesel bands + retailer cards
  fuel-stations.js      Truck-access sites on NHVR corridors
  fuel-efficiency.js    L/100 km from load, trailers, fuel mass, driver type
  fuel-planner.js       Cheapest fills + rest/refresh
  fuel-forecast.js      Conservative / Baseline / Optimistic L/km + min fill
  fuel-dashboard.js     Current run, trip history, area diesel deals
  fuel-vehicle-class.js Registered fuel-capacity classes (XN93DX / YN16BQ / YN17BQ)
  fuelhub-store.js      Per-user truck spec, cards, trips
  hub-profile.js        Shared Driver Hub identity + work vehicle for Fuel Hub
public/
  index.html            App shell / all DOM the frontend expects
  app.js                Frontend SPA (provided verbatim)
  enhancements.js       Driver Hub picker, Taxation Hub layer
  suite.js              Go Taxation Suite overlay
  fuelhub.js            Fuel Hub UI
  styles.css            Styles
  truck.svg             Icon
public/suite/           Go Taxation Suite shell (same tabs as Taxation Hub)
data/                   Runtime store + receipts (git-ignored)
```

## Accounts (multi-user profiles)

Under the **Profile** tab (or the title screen), a first-time user creates a
profile with username, **email**, and a **strong password**; existing users log
in there too. Each account has its own private data store (receipts, income,
EOFY projections, tax values and presets). A missing-data alert banner is shown
on load — including prompts when email is missing or the password is older than
90 days.

- Accounts persist to `data/users.json`; per-user records to `data/users/<name>.json`.
- Passwords are stored as salted PBKDF2 hashes; the session is an HttpOnly cookie.
- Strength checks live in `lib/password-strength.js` (length, classes, common-password blocklist).
- **Forgot password / 10 failed logins:** request recovery with the profile email;
  the link opens `/haulage/recover.html`, reveals the username, and lets the user
  set a new strong password. Without SMTP configured, the UI shows an in-app
  “Continue to reset password” button (`recoveryUrl`) instead of sending mail.
- Without logging in, the app works against a shared **guest** store.
- **Primary mod:** bootstrapped on server start from `HAULAGE_ADMIN_USERNAME` / # pragma: allowlist secret
  `HAULAGE_ADMIN_PASSWORD` (set those in the host environment; do not commit # pragma: allowlist secret
  them). On the Profile tab they see **Primary mod — user
  profiles** and can open any user’s income, expenses and receipt downloads
  (read-only), and **upgrade/downgrade Free ↔ Pro+** at any time.

## Plans (Free / Pro / Pro+)

- **Free:** 15 document uploads per calendar month + 1 on-screen EOFY report
  (live summary/report in the app). PDF/JSON export and forecast stay Pro.
  New self-register and admin-created profiles start here. One soft upgrade
  prompt per month after **8 of 15** free uploads are used.
- **Pro:** unlimited uploads, PDF + JSON accountant export, forecast.
  Taxation Hub / Driver Hub is **$5/month** or **$60/year** AUD. Go Taxation
  Suite is **$10/month** or **$110/year** AUD (two months free vs paying
  monthly). Upgrade from Profile → Plan → Upgrade to Pro.
- **Pro+:** complimentary full Pro access (same features as paid Pro). The
  primary mod grants or revokes it via Profile → Primary mod
  (`POST /api/haulage/admin/users/:username/plan`). There is no separate
  paid Pro+ checkout — paying always buys Pro.
- Signup copy via `GET /api/haulage/billing/trial`.
- Profile → **Plan** shows remaining uploads and Choose Pro plan (month/year).
- Stripe env (optional until you take cards): `STRIPE_SECRET_KEY`,
  `STRIPE_PRICE_ID`, `STRIPE_PRICE_ID_YEARLY`, `STRIPE_WEBHOOK_SECRET`, plus
  `APP_BASE_URL` for return URLs. Webhook path: `POST /api/haulage/billing/webhook`.

## Environment variables

- `PORT` — server port (default `3000`).
- `OPENAI_API_KEY` — optional; enables cloud OCR for receipts/payslips.
- `HAULAGE_ADMIN_USERNAME` — primary mod username (set in the host environment). # pragma: allowlist secret
- `HAULAGE_ADMIN_PASSWORD` — primary mod password (set in the host environment). # pragma: allowlist secret
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_PRICE_ID_YEARLY`,
  `STRIPE_PRICE_ID_SUITE`, `STRIPE_PRICE_ID_SUITE_YEARLY`,
  `STRIPE_WEBHOOK_SECRET` — optional Stripe billing. Driver Hub Pro is
  $5/mo or $60/yr; Suite Pro is $10/mo or $110/yr.
  Without them, free quotas and trials still work.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`,
  `APP_BASE_URL` — optional outbound email for recovery links and 90-day
  password reminders (`lib/mail.js`).
- `CORS_ORIGINS` — comma-separated browser/WebView origins allowed to call the
  API cross-origin with cookies (e.g.
  `capacitor://localhost,https://app.example.com`). Leave empty for same-origin
  web-only deploys (Render serving `/haulage` + `/api/haulage` together).
- `CORS_ALLOW_CAPACITOR` — set `1` to also allow common Capacitor/Ionic
  localhost origins used by Google Play / App Store WebView shells.
- `COOKIE_SECURE` — force `Secure` on session cookies (on by default when
  `NODE_ENV=production`). Cross-origin sessions use `SameSite=None; Secure`.

### Google Play / iOS (Capacitor shell)

Native packaging lives under [`mobile/`](mobile/README.md): a Capacitor 7
Android project that loads the hosted app at
`https://haulage-finance.onrender.com/haulage/` (same-origin API — no CORS
needed for the default config).

```bash
cd mobile && npm install && npx cap sync android && npx cap open android
```

If a native shell instead calls the hosted API from another origin
(`capacitor://localhost`, etc.):

1. Set `CORS_ORIGINS` (and/or `CORS_ALLOW_CAPACITOR=1`) on Render.
2. Call the API with `credentials: "include"` (not `"same-origin"`).
3. Point the client at your HTTPS API base (e.g. `https://your-app.onrender.com/api/haulage`).

## Historical financial years (accurate prior-year reconciliation)

Selecting a prior financial year reconciles that year against the ATO rules that
applied **that year**, not today's. `lib/historical-rates.js` holds verified
per-year figures and overlays them onto the summary/report:

- **Resident income tax brackets** by year (e.g. 2016-17 32.5% band to $87k;
  2018-19 to $90k; 2020-21→2023-24 19%/$45k/$120k; 2024-25+ Stage 3 16/30/37/45).
- **Temporary Budget Repair Levy** (+2% over $180k) for 2014-15 to 2016-17.
- **Cents-per-km** car rate by year (66/68/72/78/85/88/91¢) and **Super
  Guarantee** rate by year (9.5%→12%). Medicare levy 2%.

Income/expense/deduction totals are per-year sums; the tax estimate and
rate-dependent deductions (cents-per-km) use the selected year's rates.
Truck-driver meal *reasonable amounts*, overtime meal caps and travel salary
bands are FY-aware via `lib/historical-rates.js` (TD 2025/4 for 2025–26 and
earlier; TD 2026/4 for 2026–27 onwards until the next determination).

## Deploy to an always-on host

The app is a plain Node/Express server, so it runs on any host. It binds
`0.0.0.0` and honours `PORT`, and there is no build step.

### Render (one-click, real-time updates)

This repo deploys **two** Render web services from the same GitHub repository
(`render.yaml`). You do **not** need a second GitHub repo.

| Service | Product | Public URL | Persistent disk |
| --- | --- | --- | --- |
| `haulage-finance` | Driver Hub / Taxation Hub / Fuel Hub | `https://<service>.onrender.com/haulage/` | `haulage-data` |
| `go-taxation-suite` | Go Taxation Suite (`APP_PRODUCT=suite`) | `https://<service>.onrender.com/suite/` (root `/` redirects here) | `gotax-data` |

Each service has its **own disk and accounts**. A Driver Hub login does not
appear on Go Taxation Suite, and vice versa.

1. Push this repo to GitHub (already done).
2. **New Blueprint** (first time): Render dashboard → **New → Blueprint** →
   connect this repo. Render reads `render.yaml` and provisions both services.
3. **Second service only** (if `haulage-finance` already exists): Dashboard →
   **Blueprints** → this repo → **Manual Sync** so Render creates
   `go-taxation-suite` without replacing Driver Hub. Or **New → Web Service**,
   connect the **same** GitHub repo, name it `go-taxation-suite`, start command
   `node server.js`, health check `/suite/`, env `APP_PRODUCT=suite`, and attach
   a 1 GB disk at `/opt/render/project/src/data`.
4. Both redeploy on every push to the connected branch (**must be `main`**).
5. After both services are live, set host redirects in the Render dashboard so
   accidental `/suite` or `/haulage` hits on the wrong service bounce to the
   correct origin (optional but recommended):
   - On **`haulage-finance`**: `SUITE_PUBLIC_URL=https://YOUR-SUITE-SERVICE.onrender.com`
   - On **`go-taxation-suite`**: `DRIVERHUB_PUBLIC_URL=https://YOUR-DRIVERHUB-SERVICE.onrender.com`
   Also set `APP_BASE_URL` on each service to its own public HTTPS origin. Add the
   primary-mod password and optional `OPENAI_API_KEY` / Stripe / SMTP in the
   Render dashboard (do not commit those values).

You should then see **two services** in the Render dashboard (`haulage-finance`
and `go-taxation-suite`), each with its own URL, disk, and accounts. The UIs do
not cross-promote each other.

A dedicated GitHub repository is optional. If you later copy this codebase into
its own repo, keep `APP_PRODUCT=suite` and you can point a new Render service at
that repo instead of using the Blueprint’s second service.

The free plan is reachable but cold-starts after idle and has an **ephemeral
filesystem** (accounts/receipts reset on redeploy). Persistent disks on these
services need a paid `starter` plan.

### Docker (any host)

```bash
docker build -t haulage-finance .
docker run -p 3000:3000 -v haulage-data:/app/data haulage-finance
# open http://localhost:3000/haulage/

# Dedicated Go Taxation Suite host (same image, own volume):
docker run -p 3000:3000 -e APP_PRODUCT=suite -v gotax-data:/app/data haulage-finance
# open http://localhost:3000/suite/
```

The `-v haulage-data:/app/data` volume persists the JSON store, receipts and user
accounts across restarts.

### Backups

The server creates **full-store backups** (accounts, ledgers, receipt files,
history) under `data/backups/` once a day at **5:00 pm Australia/Sydney**
(`BACKUP_AT=17:00`, `BACKUP_TIMEZONE=Australia/Sydney`; keep 5 on Render / default 7). Primary mod
can also trigger, download or restore from **Profile → Primary mod → Data
backups**. Keep that tab open around 5pm and today’s archive downloads to your
computer automatically.

**Off-site via GitHub Actions (recommended):** workflow
`.github/workflows/daily-backup.yml` runs around 5pm Sydney, signs in as
primary mod, creates a backup, and stores the `.tar.gz` as a workflow artifact
(90-day retention). Add these **repository secrets** (Settings → Secrets and
variables → Actions):

| Secret | Example |
|--------|---------|
| `HAULAGE_BASE_URL` | `https://haulage-finance.onrender.com` |
| `GOTAX_BASE_URL` | `https://go-taxation-suite.onrender.com` |
| `HAULAGE_ADMIN_USERNAME` | *(primary-mod username secret)* | # pragma: allowlist secret
| `HAULAGE_ADMIN_PASSWORD` | *(your primary mod password)* | # pragma: allowlist secret

Then: Actions → **Daily data backup** → **Run workflow** once to verify.
Scheduled runs need no further clicks. Download any day’s file from that
workflow’s Artifacts list.

Go Taxation Suite uses the same script with secret `GOTAX_BASE_URL` (workflow
`.github/workflows/daily-backup-suite.yml`).

Optional extras: `BACKUP_S3_BUCKET` + AWS credentials, or `BACKUP_OFFSITE_DIR`.
`BACKUP_NOTIFY_EMAIL` / `SUPPORT_EMAIL` can email when a server-side backup
finishes. Set `BACKUP_ENABLED=0` to disable the in-app scheduler.

> For production multi-user use, prefer off-site backups (S3) in addition to the
> persistent disk, and serve over HTTPS with `Secure` cookies.

## API (base `/api/haulage`)

`GET /standards`, `GET /records`, `GET /summary`, `GET /report`, `GET /forecast`,
`PUT /profile`, `POST|DELETE /expenses`, `POST /expenses/preview`,
`POST|DELETE /income`, `POST /receipts/scan`, `POST /receipts/manual`,
`POST /receipts/:id/confirm`, `GET /receipts/:id/image`, `GET /receipts/:id/file`.
