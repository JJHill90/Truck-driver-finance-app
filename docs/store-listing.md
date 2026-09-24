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
| Support (no login) | `https://go-taxation-suite.onrender.com/support` |
| Support email | `support@godriverhub.com` |

Do not submit Driver Hub (`com.haulagefinance.app` / `mobile/`).

Checked 24 September 2026 against the live Suite host and this branch
(official icon = colour option 6: white tile, black page, blue fold,
orange bottom line, opacity GO inside the box).

## Verdict

**Ready to start the store consoles.** Product, legal pages, icon,
screenshots, iOS project, and reviewer bootstrap are in the repo.

Still required **outside this repo** before a reviewer can approve:

1. Signed Play AAB (Android Studio + your keystore).
2. Xcode archive on a Mac (signing team + TestFlight).
3. Set `SUITE_REVIEWER_USERNAME` + `SUITE_REVIEWER_PASSWORD` on the
   Render service `go-taxation-suite`, then paste those credentials in
   review notes.
4. Land this branch on `main` so Render serves the new `/suite/icon-512.png`
   and `/support` page. Privacy and Terms are already live on `main`.

## Already done in the product

| Requirement | Status | Where |
|-------------|--------|--------|
| Own name, id, and `/suite/` URL | Done | `mobile-suite/capacitor.config.json` |
| Android `targetSdk` 35, camera optional | Done | `mobile-suite/android/` |
| iPhone-only (no iPad screenshot set needed) | Done | `TARGETED_DEVICE_FAMILY = 1` |
| iOS camera / photos / export-compliance | Done | `Info.plist` + `ios-info.plist.additions.xml` |
| iOS privacy manifest | Done | `mobile-suite/ios/App/App/PrivacyInfo.xcprivacy` |
| Public Privacy + Terms (Suite only) | Live | `/privacy` and `/terms` return 200 |
| Public Support URL (Apple requires one) | In repo | `public/support.html` → `/support` |
| In-app account deletion (Apple 5.1.1(v)) | Done | Profile → Delete account |
| Capacitor CORS / `SameSite=None` cookies | Done | `CORS_ALLOW_CAPACITOR=1` on Suite |
| Hide Stripe checkout in the native shell | Done | `enhancements.js` `isNativeShell()` |
| Honest tax wording | Done | Privacy, Terms, Support, BAS worksheet |
| Official store / launcher icon | Done | Option 6 + blue fold + orange underline |
| Play feature graphic 1024×500 | Done | `mobile-suite/store/feature-graphic-1024x500.png` |
| Phone screenshots (Play + App Store 6.7") | Done | `mobile-suite/store/screenshots/` |
| Reviewer demo bootstrap | Done | `SUITE_REVIEWER_*` → `lib/reviewer-demo.js` |

## Official icon

White tile, black page, blue outline, opacity blue **GO** clipped inside
the page, blue fold, white mid-lines, orange bottom line.

- Play: `mobile-suite/store/icon-play-512.png` (512, opaque RGBA)
- App Store (no alpha): `mobile-suite/store/icon-appstore-1024.png`
- Web / apple-touch: `public/suite/icon-512.png`
- Regenerate: `python3 mobile-suite/store/generate-icons.py`

## Must finish in the consoles

### Google Play

On a machine with Android Studio:

```bash
cd mobile-suite
npm install
npx cap sync android
npx cap open android
```

**Build → Generate Signed Bundle.** Keep the keystore **out of git**.

Then in Play Console for `com.gotaxation.suite`:

1. Upload the AAB (Internal testing, then Production).
2. Privacy policy = `https://go-taxation-suite.onrender.com/privacy`
3. Data safety (answers below)
4. Photo/video permission: camera and photos are for receipt capture only;
   not required (file upload works)
5. IARC content rating (finance / tools — typically Everyone / PEGI 3)
6. Store listing: copy below. Screenshots:
   `mobile-suite/store/screenshots/play-1080x1920/`. Feature graphic:
   `mobile-suite/store/feature-graphic-1024x500.png`.
7. Category: **Business** or **Finance**
8. Contact: `support@godriverhub.com` and
   `https://go-taxation-suite.onrender.com/support`

Play does **not** get a Stripe/IAP product. This build is a login WebView.

### Apple App Store (Mac required)

```bash
cd mobile-suite
npm install
npx cap sync ios
npx cap open ios
```

Xcode team signing → Archive → TestFlight → App Store.

In App Store Connect:

1. Privacy Policy URL = `https://go-taxation-suite.onrender.com/privacy`
2. Support URL = `https://go-taxation-suite.onrender.com/support`
3. App Privacy nutrition labels (below)
4. Account deletion: in-app **and** described on `/privacy` (5.1.1(v))
5. Age rating: 4+ (no UGC chat, no gambling)
6. Category: Business / Finance
7. Devices: **iPhone** (iPad is off so you do not need 13" iPad shots)
8. Review notes: login client; subscriptions are Stripe on the website;
   no IAP; demo username + password from Render `SUITE_REVIEWER_*`
9. Export compliance: HTTPS only, non-exempt encryption = No

## Listing copy (paste)

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

## Data safety / App Privacy answers

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

## Reviewer demo account

On **go-taxation-suite** in Render set:

- `SUITE_REVIEWER_USERNAME` — e.g. `suite.reviewer`
- `SUITE_REVIEWER_PASSWORD` — a strong password you choose (never commit it)
- `SUITE_REVIEWER_EMAIL` — optional; defaults to `support+reviewer@godriverhub.com`

The next boot creates a non-admin complimentary Pro+ profile with a small
PAYG sample ledger. It does not reset an existing password.

Paste in Play / App Review notes:

- URL: `https://go-taxation-suite.onrender.com/suite/`
- Username / password: the env values you set
- How to delete: Profile → Delete account → type DELETE

Do not give reviewers the primary mod login.

## Residual policy risk

Pro features are digital. Stripe checkout is hidden in the native shell.
Reviewers can still ask for Apple IAP or Play Billing. If they do, do not
turn Stripe checkout back on in the app.

Do **not** say “official BAS”, “we lodge your return”, or “ATO approved”.
