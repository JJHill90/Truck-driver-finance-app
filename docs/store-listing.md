# Store listing — Go Taxation Suite

Compile **Go Taxation Suite only** for Google Play and the App Store.

| Listing | Application id | Loads | Native project |
|---------|----------------|-------|----------------|
| **Go Taxation Suite** | `com.gotaxation.suite` | `https://go-taxation-suite.onrender.com/suite/` | `mobile-suite/` |

Do not submit Driver Hub (`com.haulagefinance.app` / `mobile/`) unless you later
decide to list that product separately. Privacy and Terms used for the stores
are Suite-only (no Driver Hub, Taxation Hub, or Fuel Hub).

Uploading the binaries still needs your Apple Developer and Google Play Console
accounts, signing keys, and a Mac for iOS.

## Privacy Policy URL (Play and App Store)

After this deploy, the Suite pages are public (no login):

- `https://go-taxation-suite.onrender.com/privacy`
- `https://go-taxation-suite.onrender.com/terms`
- Aliases: `/suite/privacy` and `/suite/terms` on the Suite host

Play Console → App content → Privacy policy, and App Store Connect → App
Privacy → Privacy Policy URL, must use those HTTPS URLs.

## Account deletion (Apple 5.1.1(v) + Play data safety)

Signed-in users: **Profile → Delete account** (type `DELETE` + password).
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

| Plan | AUD |
|------|-----|
| Pro | $10/mo or $110/yr |
| Pro+ | $18/mo or $190/yr |

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

### Google Play (Go Taxation Suite)

1. Create one app in Play Console: `com.gotaxation.suite`.
2. On a machine with Android Studio: `cd mobile-suite && npm install && npx cap sync android`
   then **Build → Generate Signed Bundle** (your keystore, not in git).
3. Upload the AAB to Internal testing, then Production.
4. Privacy policy URL: `https://go-taxation-suite.onrender.com/privacy`.
   Fill Data safety and the camera permission declaration.

### Apple App Store (Go Taxation Suite)

1. On a Mac: `cd mobile-suite && npm install && npx cap add ios && npx cap sync ios`
   then paste `mobile-suite/ios-info.plist.additions.xml` into `Info.plist`.
2. Xcode signing (your Apple Development / Distribution team).
3. Archive → TestFlight → App Store.
4. App Privacy + account-deletion URL (`https://go-taxation-suite.onrender.com/privacy`)
   + 5.1.1(v) in-app delete (Profile → Delete account).

## Render env (already in Blueprint)

Confirm `go-taxation-suite` has `CORS_ALLOW_CAPACITOR=1` after this deploy. Set
`APP_BASE_URL` to the Suite public HTTPS origin so Stripe portal return links
work on the web.
