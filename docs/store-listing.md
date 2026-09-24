# Go Taxation Suite — store submission check

Compile **only** this listing:

| Field | Value |
|-------|--------|
| Name | Go Taxation Suite |
| Application id | `com.gotaxation.suite` |
| Loads | `https://go-taxation-suite.onrender.com/suite/` |
| Native project | `mobile-suite/` |
| Privacy (no login) | `https://go-taxation-suite.onrender.com/privacy` |
| Terms (no login) | `https://go-taxation-suite.onrender.com/terms` |
| Support | `support@godriverhub.com` |

Do not submit Driver Hub (`com.haulagefinance.app` / `mobile/`).

Checked 24 September 2026 against the live Suite host after the merge to `main`.

## Verdict

**Privacy, Terms, icon, feature graphic, listing screenshots, iOS project,
and reviewer-account bootstrap are in the repo.** Remaining work is the
store consoles: signed AAB, Xcode archive on a Mac, and setting the
reviewer password on Render.

## Already done in the product

| Requirement | Status | Where |
|-------------|--------|--------|
| Own name, id, and `/suite/` URL | Done | `mobile-suite/capacitor.config.json` |
| Android project, `targetSdk` 35 | Done | `mobile-suite/android/` |
| Camera + photo permissions + rationale | Done | AndroidManifest + `strings.xml` `camera_rationale` |
| iOS usage strings ready to paste | Done | `mobile-suite/ios-info.plist.additions.xml` |
| Public Privacy + Terms (Suite only) | Done in repo | `public/privacy.html`, `public/terms.html` |
| In-app account deletion (Apple 5.1.1(v)) | Done | Profile → Delete account; `POST /auth/account/delete` |
| WebView CORS / `SameSite=None` cookies | Done in Blueprint | `CORS_ALLOW_CAPACITOR=1` on `go-taxation-suite` |
| Hide Stripe checkout in the native shell | Done | `enhancements.js` `isNativeShell()` |
| Auto-renew / cancel / no fake Restore IAP | Done | Terms + Profile Plan copy |
| Honest tax wording (not a lodged BAS) | Done | Privacy, Terms, Support, BAS worksheet |
| Website account deletion instructions | Done | `/privacy` |
| Suite store / launcher icon | Done | `mobile-suite/store/` + Android mipmaps |
| Play feature graphic 1024×500 | Done | `mobile-suite/store/feature-graphic-1024x500.png` |
| Phone screenshots (Play + App Store) | Done | `mobile-suite/store/screenshots/` |
| iOS Xcode project + camera / export keys | Done | `mobile-suite/ios/` + `ios-info.plist.additions.xml` |
| Reviewer demo account bootstrap | Done | `SUITE_REVIEWER_*` env → `lib/reviewer-demo.js` |

## Must finish before Google or Apple will accept the app

### 1. Deploy Privacy and Terms — done

Live check after merge to `main`:

- `https://go-taxation-suite.onrender.com/suite/` — **up**
- `https://go-taxation-suite.onrender.com/privacy` — **200** (Go Taxation Suite)
- `https://go-taxation-suite.onrender.com/terms` — **200** (Go Taxation Suite)

Use those two HTTPS URLs in Play Console and App Store Connect.

Also confirm in the Render dashboard for `go-taxation-suite`:

- `CORS_ALLOW_CAPACITOR=1`
- `APP_BASE_URL=https://go-taxation-suite.onrender.com`

### 2. Suite icon — done

Navy document mark (sky fold, amber underline). No truck, not the Capacitor X.

- Play: `mobile-suite/store/icon-play-512.png`
- App Store (no alpha): `mobile-suite/store/icon-appstore-1024.png`
- Source SVG: `mobile-suite/store/icon.svg`
- Android adaptive + legacy mipmaps in `mobile-suite/android/app/src/main/res/`
- Regenerate: `python3 mobile-suite/store/generate-icons.py`

### 3. Google Play (your console + a signed AAB)

On a machine with Android Studio:

```bash
cd mobile-suite
npm install
npx cap sync android
npx cap open android
```

Then **Build → Generate Signed Bundle**. Keep the keystore **out of git**.

In Play Console create **one** app `com.gotaxation.suite` and complete:

1. Upload the AAB to Internal testing, then Production.
2. Privacy policy = `https://go-taxation-suite.onrender.com/privacy`
3. Data safety (paste answers below)
4. Photo/video permission declaration: camera and photos are for receipt capture only; not required to use the app (Upload file works)
5. IARC content rating (finance / tools — typically everyone / PEGI 3)
6. Store listing: short + full description below. Phone screenshots live in
   `mobile-suite/store/screenshots/play-1080x1920/`. Feature graphic:
   `mobile-suite/store/feature-graphic-1024x500.png`.
7. Category: **Business** or **Finance**
8. Contact: `support@godriverhub.com`

Play does **not** get a Stripe/IAP product. This build is a login WebView.

### 4. Apple App Store (Mac required)

`mobile-suite/ios/` is already in the repo (`com.gotaxation.suite`). Info.plist
already has camera / photo-library usage strings and
`ITSAppUsesNonExemptEncryption = false` (HTTPS login only — no custom crypto).
The same keys are in `ios-info.plist.additions.xml` if you ever re-add the
platform.

On a Mac:

```bash
cd mobile-suite
npm install
npx cap sync ios
npx cap open ios
```

Then Xcode team signing → Archive → TestFlight → App Store. CocoaPods /
`xcodebuild` are not available in this Linux tree — run those on the Mac.

In App Store Connect:

1. Privacy Policy URL = `https://go-taxation-suite.onrender.com/privacy`
2. App Privacy nutrition labels (below)
3. Account deletion: in-app **and** described on `/privacy` (5.1.1(v))
4. Age rating: 4+ (no UGC chat, no gambling)
5. Category: Business / Finance
6. Review notes: this is a **login / reader-style** client. Subscriptions are
   purchased on the website (Stripe). The app does not offer IAP and hides
   Upgrade. Provide a demo username + password for reviewers.
7. Export compliance: HTTPS only, non-exempt encryption = No

### 5. Listing copy (paste)

**Name:** Go Taxation Suite

**Short (Play, ≤80):**  
Record Australian tax receipts and working papers. Not advice. You lodge with the ATO.

**Description:**

Go Taxation Suite helps PAYG employees, sole traders and partnerships save
receipts and income, scan documents, and prepare live tax working papers —
including an ATO-box BAS worksheet (G1, 1A, G11, 1B, 9) you can download and
copy when you lodge.

This is not tax advice and not an official ATO product. The app does not lodge
a BAS or tax return. You (or your registered agent) lodge with the ATO.

Free: 15 uploads a month and one on-screen EOFY report. Pro ($10/month or
$110/year AUD) and Pro+ ($18/month or $190/year AUD) are sold on the website
via Stripe, auto-renew, and cancel from Profile → Plan or the Stripe customer
portal. The store app does not sell in-app purchases.

Camera and photos are used only when you choose to photograph a receipt or
payslip. You can upload a file instead.

Delete your account any time: Profile → Delete account (type DELETE and your
password), or email support@godriverhub.com.

**Keywords (Apple):** tax, BAS, GST, ATO, receipts, sole trader, PAYG, Australia

### 6. Data safety / App Privacy answers

Collect / linked to identity / not used for advertising or tracking:

| Data | Why | Required? |
|------|-----|-----------|
| Email, name, account | Sign-in, recovery | Yes to create an account |
| Financial info (your ledgers) | App functionality | Yes if you use the ledgers |
| Photos | Receipt / payslip capture | No — file upload works |
| App activity (support messages) | Customer support | No |

- Sold: **No**
- Tracking: **No**
- Advertising: **No**
- Encryption in transit: **Yes** (HTTPS)
- Users can request deletion: **Yes** (in-app + email)

Payments: Stripe on the **website** only. Card numbers are not stored in this app.

### 7. Reviewer demo account

On the **go-taxation-suite** Render service set:

- `SUITE_REVIEWER_USERNAME` — e.g. `suite.reviewer`
- `SUITE_REVIEWER_PASSWORD` — a strong password you choose (never commit it)
- `SUITE_REVIEWER_EMAIL` — optional; defaults to `support+reviewer@godriverhub.com`

The next boot creates a **non-admin** complimentary Pro+ profile with a small
PAYG sample ledger (`lib/reviewer-demo.js`). It does not reset an existing
password. Paste those credentials in Play / App Review notes:

- URL: `https://go-taxation-suite.onrender.com/suite/`
- Username / password: the env values you set
- How to delete: Profile → Delete account → type DELETE

Do not give reviewers the primary mod login.

## Residual policy risk (read this)

Pro features are digital (uploads, PDF, BAS worksheet). We hide Stripe checkout
inside the native shell and treat the app as a login client. That matches the
stores’ “buy on the website, use in the app” pattern, but a reviewer can still
ask for Apple IAP or Play Billing later. If they do, do not turn Stripe checkout
back on in the app — add store IAP or keep the app login-only.

## Honest tax wording (stores and ATO)

Use the description above. Do **not** say “official BAS”, “we lodge your return”,
or “ATO approved”.
