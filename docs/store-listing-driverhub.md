# Driver Hub — Google Play submission

Compile **only** this listing:

| Field | Value |
|-------|--------|
| Name | Driver Hub |
| Application id | `com.haulagefinance.app` |
| Loads (Play WebView — the **app**) | `https://godriverhub.com/haulage/` |
| Official marketing site (browser only) | `https://godriverhub.com/` |
| Privacy (public, no login) | `https://godriverhub.com/privacy` |
| Terms (public, no login) | `https://godriverhub.com/terms` |
| Support | `https://godriverhub.com/support` |
| Native project | `mobile/` |
| Support email | `support@godriverhub.com` |

Do not submit Go Taxation Suite (`com.gotaxation.suite` / `mobile-suite/`) from this pack.

The Play package must load **`https://godriverhub.com/haulage/`** (Driver Hub login + Taxation Hub / Fuel Hub) — the same “go straight to the service” pattern as Suite’s `/suite/`. Do **not** point the WebView at `https://godriverhub.com/` (marketing homepage), and do **not** use `www.gotaxation.com.au` (that host does not exist). `www.godriverhub.com` only redirects to the apex. This release is **versionCode 4 / `1.0.3`**. It opens the apex `/haulage/` directly (`curl -sI https://godriverhub.com/haulage/` is 200; see `docs/custom-domain-driverhub.md`). Play Console privacy and terms use `https://godriverhub.com/privacy` and `https://godriverhub.com/terms`. The same pages are also inside the app at `/haulage/privacy` and `/haulage/terms`. In the WebView, a tap on `/privacy`, `/terms`, or `/support` is sent to those `/haulage/…` pages so the marketing site stays in the browser.

Build Driver Hub from this repo’s **`mobile/`** folder (`com.haulagefinance.app`). Do not open the Suite Android Studio project (`mobile-suite/` or a local `comgotaxationsuite` tree).

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
| Public Privacy + Terms (Driver Hub) | Live | `https://godriverhub.com/privacy` and `https://godriverhub.com/terms` |
| Public Support | Live | `https://godriverhub.com/support` |
| Public marketing overview | Live | `https://godriverhub.com/` |
| Play version for this release | `versionCode` 4 / `1.0.3` | `mobile/android/app/build.gradle` |
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

**Build → Generate Signed Bundle** (`versionCode` 4 / `1.0.3`). Always sync **before** the bundle. Use the **same upload keystore** already registered for `com.haulagefinance.app`. Keep it offline and out of git. This repository has no keystore and no GitHub Action that builds an AAB, so the signed file is produced only on that machine. Android Studio writes it under `mobile/android/app/build/outputs/bundle/release/app-release.aab` (or the folder you pick in the wizard). Upload that `.aab`. Confirm the bundle is versionCode **4**, versionName **1.0.3**. Do not upload a build that opened Chrome, the marketing homepage, or `www.gotaxation.com.au`.

Then in Play Console for `com.haulagefinance.app`:

1. Create the app (default language English (Australia) if offered).
2. Upload the AAB to **Internal testing**, install on a phone, confirm login — then Production (or closed testing first).
3. Privacy policy = `https://godriverhub.com/privacy`
4. Data safety (answers below)
5. Photo/video permission: camera and photos are for receipt capture only; not required (file upload works)
6. IARC content rating (finance / tools — typically Everyone / PEGI 3)
7. Store listing: copy below. Screenshots: `mobile/store/screenshots/play-1080x1920/`. Feature graphic: `mobile/store/feature-graphic-1024x500.png`. High-res icon: `mobile/store/icon-play-512.png`. Marketing URL: `https://godriverhub.com/`
8. After the listing is live, set `DRIVERHUB_PLAY_STORE_URL` on `haulage-finance` so the overview Play button goes live.
9. Category: **Business** or **Finance**
10. Contact: `support@godriverhub.com` and `https://godriverhub.com/support`

Play does **not** get a Stripe/IAP product. This build is a login WebView. Subscriptions stay on the website.

Play Console URLs for this listing:

| Play field | URL |
|------------|-----|
| Privacy policy | `https://godriverhub.com/privacy` |
| Terms | `https://godriverhub.com/terms` |
| Support / contact website | `https://godriverhub.com/support` |
| Marketing | `https://godriverhub.com/` |

## Release notes (Play “What’s new”, versionCode 4 / 1.0.3)

Paste for en-AU (under 500 characters):

```text
Opens Driver Hub at https://godriverhub.com/haulage/. www.godriverhub.com redirects to that site. Store links: privacy https://godriverhub.com/privacy, terms https://godriverhub.com/terms, support https://godriverhub.com/support.
```

## App Links

Driver Hub does not use Android App Links. The manifest has only the launcher intent filter (no `VIEW` / `autoVerify` host). `https://godriverhub.com/.well-known/assetlinks.json` returns 200 and names **Go Taxation Suite** (`com.gotaxation.suite`), because the shared Express app serves that file. Do not paste that package or fingerprint into the Driver Hub Play listing, and do not add an App Link filter in this release.

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

Support: https://godriverhub.com/support
Privacy: https://godriverhub.com/privacy

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
