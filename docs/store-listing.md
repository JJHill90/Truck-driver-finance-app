# Store listings — Driver Hub and Go Taxation Suite

This repo is **store-ready**. Uploading the binaries still needs your Apple
Developer and Google Play Console accounts, signing keys, and a Mac for iOS.
A Linux cloud agent cannot finish TestFlight or Play Console publish.

## Two listings (do not reuse one app id)

| Listing | Application id | Loads | Native project |
|---------|----------------|-------|----------------|
| **Driver Hub** | `com.haulagefinance.app` | hosted `/haulage/` | `mobile/` |
| **Go Taxation Suite** | `com.gotaxation.suite` | `https://go-taxation-suite.onrender.com/suite/` | `mobile-suite/` |

Set Driver Hub `mobile/capacitor.config.json` `server.url` to the real
production origin before a release build (the committed value is a placeholder).
Suite already points at the public Render host.

## Privacy Policy URL (both stores)

After this deploy, the pages are public (no login):

- `https://go-taxation-suite.onrender.com/privacy`
- `https://go-taxation-suite.onrender.com/terms`
- Same paths on the Driver Hub host: `https://<driver-hub-host>/privacy`

Play Console → App content → Privacy policy, and App Store Connect → App
Privacy → Privacy Policy URL, must use those HTTPS URLs.

## Account deletion (Apple 5.1.1(v) + Play data safety)

Signed-in drivers: **Profile → Delete account** (type `DELETE` + password).
API: `POST /api/haulage/auth/account/delete`. Also described on `/privacy`.
Primary mod cannot self-delete.

## Camera / photos

Android manifests include `CAMERA` (not required hardware) plus photo-read
permissions. iOS strings are in `mobile/ios-info.plist.additions.xml` and
`mobile-suite/ios-info.plist.additions.xml` — paste into `Info.plist` after
`npx cap add ios` on a Mac.

Play Data safety: photos are **app functionality** (receipt capture), not
advertising; users can deny the permission and upload a file instead.

## CORS for the WebView

`render.yaml` now defaults `CORS_ALLOW_CAPACITOR=1` on both services so
`capacitor://localhost` (and the other Capacitor origins) get credentialed
CORS and `SameSite=None; Secure` session cookies. Optionally set
`CORS_ORIGINS` in the dashboard for extra custom schemes.

## Subscription copy (stores + in-app)

Paid plans are **website Stripe only** in this version — not Apple IAP or
Play Billing. Native shells hide “Upgrade to Pro” checkout and show that
auto-renewal, price, and cancel live on the website Profile → Plan.

| Product | Plan | AUD |
|---------|------|-----|
| Driver Hub | Pro | $5/mo or $60/yr |
| Go Taxation Suite | Pro | $10/mo or $110/yr |
| Go Taxation Suite | Pro+ | $18/mo or $190/yr |

Cancel: website Profile → Cancel subscription (access until period end) or
Manage billing (Stripe portal). Deleting the account cancels Stripe immediately.
There is no Restore purchases control until store IAP exists.

Do **not** link Stripe Checkout from the iOS/Android upgrade button.

## Honest tax wording

Use this short description (or close):

> Record receipts and prepare Australian tax working papers. Not tax advice
> and not an official ATO lodgement — you (or your agent) lodge the BAS or
> return with the ATO.

Do **not** say “official BAS”, “we lodge your return”, or “ATO approved”.

## What you do next (cannot be done in this environment)

### Google Play (both apps)

1. Create two apps in Play Console with the application ids above.
2. On a machine with Android Studio: `cd mobile && npm install && npx cap sync android`
   then **Build → Generate Signed Bundle** (your keystore, not in git).
   Repeat in `mobile-suite/`.
3. Upload each AAB to Internal testing, then Production.
4. Fill Data safety, Privacy policy URL, camera permission declaration.

### Apple App Store (both apps)

1. On a Mac: `cd mobile && npm install && npx cap add ios && npx cap sync ios`
   then paste `ios-info.plist.additions.xml` into `Info.plist`. Repeat for
   `mobile-suite`.
2. Xcode signing (your Apple Development / Distribution team).
3. Archive → TestFlight → App Store.
4. App Privacy + account-deletion URL (`/privacy`) + 5.1.1(v) in-app delete.

## Render env (already in Blueprint)

Confirm both `haulage-finance` and `go-taxation-suite` have
`CORS_ALLOW_CAPACITOR=1` after this deploy. Set `APP_BASE_URL` to each
service’s public HTTPS origin so Stripe portal return links work on the web.
