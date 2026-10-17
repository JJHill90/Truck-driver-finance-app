# Driver Hub — Google Play submission

Compile **only** this listing:

| Field | Value |
|-------|--------|
| Name | Driver Hub |
| Application id | `com.haulagefinance.app` |
| Loads (Play WebView — the **app**) | `https://godriverhub.com/haulage/` |
| Official marketing site (browser only) | `https://godriverhub.com/` |
| Privacy (Hub, no login) | `https://godriverhub.com/haulage/privacy` |
| Terms (Hub, no login) | `https://godriverhub.com/haulage/terms` |
| Support | `https://www.godriverhub.com/support` |
| Native project | `mobile/` |
| Support email | `support@godriverhub.com` |

Do not submit Go Taxation Suite (`com.gotaxation.suite` / `mobile-suite/`) from this pack.

The Play package must load **`/haulage/`** (Driver Hub login + Taxation Hub / Fuel Hub). Do not point Capacitor at `https://godriverhub.com/` — that URL is the public **website**. A www → apex 301 on `/haulage/` also opens Chrome; the shell skips that hop. Until Hub-legal pages are on `main`, Play Console privacy/terms must still use `/haulage/privacy` and `/haulage/terms`.

## Verdict

**Ready to start Play Console** once you sign a release AAB on a machine with Android Studio. Product, crash-safe WebView, icon, feature graphic, screenshots, listing copy, and reviewer bootstrap are in the repo.

Still required **outside this repo**:

1. Google Play Developer account (one-time registration).
2. Signed Play AAB (Android Studio + your keystore — keep the keystore **out of git**).
3. Set `HUB_REVIEWER_USERNAME` + `HUB_REVIEWER_PASSWORD` on Render service `haulage-finance`, then paste those credentials in review notes.
4. Land this branch on `main` so production serves the reviewer bootstrap (the live site already serves `/haulage/` and Hub support).

## Already done in the product

| Requirement | Status | Where |
|-------------|--------|--------|
| Own name, id, hosted `/haulage/` URL | Done | `mobile/capacitor.config.json` |
| Android `targetSdk` 35, camera optional | Done | `mobile/android/` |
| Crash-safe launch (no `server.url` proxy) | Done | `MainActivity` + `HubNavigationPlugin` |
| Android 12 splash is a **color** (PNG crashes) | Done | `styles.xml` |
| Public Privacy + Terms (Driver Hub) | Live | `/haulage/privacy` and `/haulage/terms` |
| Public Support | Live | `/support` |
| Public marketing overview | Live | `https://www.godriverhub.com/` |
| In-app account deletion | Done | Profile → Delete account |
| Hide Stripe checkout in the native shell | Done | `enhancements.js` `isNativeShell()` |
| Play feature graphic 1024×500 | Done | `mobile/store/feature-graphic-1024x500.png` |
| Phone screenshots 1080×1920 | Done | `mobile/store/screenshots/play-1080x1920/` |
| Reviewer demo bootstrap | Done | `HUB_REVIEWER_*` → `lib/reviewer-demo.js` |

## Must finish in Play Console

On a machine with Android Studio:

```bash
cd mobile
npm install
npx cap sync android
npx cap open android
```

**Build → Generate Signed Bundle** (`versionCode` 2 / `1.0.1`). Always sync **before** the bundle. Create a Play App signing keystore and store it offline. Upload this AAB over the build that opened the marketing website in Chrome.

Then in Play Console for `com.haulagefinance.app`:

1. Create the app (default language English (Australia) if offered).
2. Upload the AAB to **Internal testing**, install on a phone, confirm login — then Production (or closed testing first).
3. Privacy policy = `https://www.godriverhub.com/haulage/privacy`
4. Data safety (answers below)
5. Photo/video permission: camera and photos are for receipt capture only; not required (file upload works)
6. IARC content rating (finance / tools — typically Everyone / PEGI 3)
7. Store listing: copy below. Screenshots: `mobile/store/screenshots/play-1080x1920/`. Feature graphic: `mobile/store/feature-graphic-1024x500.png`. High-res icon: `mobile/store/icon-play-512.png`. Marketing URL: `https://www.godriverhub.com/`
8. After the listing is live, set `DRIVERHUB_PLAY_STORE_URL` on `haulage-finance` so the overview Play button goes live.
9. Category: **Business** or **Finance**
10. Contact: `support@godriverhub.com` and `https://www.godriverhub.com/support`

Play does **not** get a Stripe/IAP product. This build is a login WebView. Subscriptions stay on the website.

## Listing copy (paste)

**Name:** Driver Hub

**Short (Play, ≤80):**  
Truck tax records and diesel planning. Not advice. You lodge with the ATO.

**Description (Play, ≤4000; this copy is 2216):**

Driver Hub is a cab-side assistant for Australian truck drivers. One login helps you keep tax records and diesel planning in the same place, so you are not sorting dockets on the kitchen table after a long run.

Sign in once, then open Taxation Hub or Fuel Hub. Your name, employer, licence class and work vehicle stay on one profile and feed both apps. Use it in the yard, at the servo, or in the bunk — photograph the paper while you still have it.

HOW TAXATION HUB HELPS
Photograph a meal docket, travel groceries or a payslip before it lives in the door pocket. Approve the totals and they land on your expense or income ledger for the financial year you are working. The dashboard shows spend against what you actually took home. A live EOFY working paper updates as you go — something you (or your registered agent) can use when you lodge with the ATO.

It also helps you keep travel / LAFHA days, car claims (cents per kilometre or logbook) and a tax estimate in view between trips, so you can see where you stand before EOFY is on top of you. Figures are indicative. This is assistance, not someone doing the return for you.

HOW FUEL HUB HELPS
Plan diesel fills on NHVR truck-access freight corridors from load, trailers and tank — not a car-nav shortcut. Rank truck-access stops and size a fill so you are not brim-filling at the dearest bowser if you do not need to.

WHAT THIS APP IS (AND IS NOT)
Driver Hub is an assistance tool. It is not tax, financial or legal advice and not an official ATO product. It does not lodge a BAS or tax return. You (or your registered agent) lodge with the ATO.

FREE AND PRO
Free: 15 uploads a month and one on-screen EOFY report. Taxation Hub Pro ($5/month or $60/year AUD) is sold on the website via Stripe, auto-renews, and cancels from Profile → Plan or the Stripe customer portal. The store app does not sell in-app purchases.

Camera and photos are used only when you choose to photograph a receipt or payslip. You can upload a file instead.

Delete your account any time: Profile → Delete account (type DELETE and your password), or email support@godriverhub.com.

Support: https://www.godriverhub.com/support
Privacy: https://www.godriverhub.com/haulage/privacy

## Data safety / App Privacy answers

Collect / linked to identity / not used for advertising or tracking:

| Data | Why | Required? |
|------|-----|-----------|
| Email, name, account | Sign-in, recovery | Yes to create an account |
| Financial info (your ledgers) | App functionality | Yes if you use the ledgers |
| Photos | Receipt / payslip capture | No — file upload works |
| App activity (support messages) | Customer support | No |
| Location (Fuel Hub, optional) | Nearby diesel / route planning | No |

- Sold: **No**
- Tracking: **No**
- Advertising: **No**
- Encryption in transit: **Yes** (HTTPS)
- Users can request deletion: **Yes** (in-app + email)

Payments: Stripe on the **website** only. Card numbers are not stored in this app.

## Reviewer demo account

On **haulage-finance** in Render set:

- `HUB_REVIEWER_USERNAME` — e.g. `hub.reviewer`
- `HUB_REVIEWER_PASSWORD` — a strong password you choose (never commit it)
- `HUB_REVIEWER_EMAIL` — optional; defaults to `support+reviewer@godriverhub.com`

The next boot creates a non-admin complimentary Pro+ profile with a small truck-driver sample ledger. It does not reset an existing password.

Paste in Play review notes:

- URL: `https://godriverhub.com/haulage/`
- Username / password: the env values you set
- How to delete: Profile → Delete account → type DELETE

Do not give reviewers the primary mod login.

## Residual policy risk

Pro features are digital. Stripe checkout is hidden in the native shell.
Reviewers can still ask for Play Billing. If they do, do not turn Stripe
checkout back on in the app.

Do **not** say “we lodge your return”, “ATO approved”, or mix this listing
with Go Taxation Suite.
