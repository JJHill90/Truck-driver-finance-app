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

**Privacy and Terms are live.** Store-facing URLs return 200 on the Suite host
(Suite-only copy, no Driver Hub). Remaining work is the store consoles: branded
icon, signed AAB, Mac/iOS project, listing assets, and a reviewer demo account.

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

### 2. Suite icon (blocker for a serious listing)

The Android launcher is still the default Capacitor “X” mark, not the Suite
document mark. Before a store build, replace it with a unique Go Taxation Suite
icon (navy/sky document, no truck):

- Play: 512×512 PNG
- App Store: 1024×1024 PNG (no alpha)
- Android adaptive icons under `mobile-suite/android/app/src/main/res/mipmap-*`

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
6. Store listing: short + full description below, phone screenshots, 1024×500 feature graphic
7. Category: **Business** or **Finance**
8. Contact: `support@godriverhub.com`

Play does **not** get a Stripe/IAP product. This build is a login WebView.

### 4. Apple App Store (Mac required)

This Linux tree has **no** `mobile-suite/ios/` Xcode project.

On a Mac:

```bash
cd mobile-suite
npm install
npx cap add ios
npx cap sync ios
```

Paste `ios-info.plist.additions.xml` into `ios/App/App/Info.plist`. Add:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

(HTTPS login only — no custom crypto.)

Then Xcode team signing → Archive → TestFlight → App Store.

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

Create a throwaway Suite user on the **production** Suite host (not Driver Hub)
and put it in Play / App Review notes, for example:

- URL: `https://go-taxation-suite.onrender.com/suite/`
- Username / password: (you create these)
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
