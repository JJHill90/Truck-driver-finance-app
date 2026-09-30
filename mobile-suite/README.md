# Go Taxation Suite — mobile shell (Capacitor)

Second store listing. Native Android (and later iOS) wrapper around the
**hosted** web app at `https://go-taxation-suite.onrender.com/suite/`.

Do **not** reuse Driver Hub’s application id (`com.haulagefinance.app`).
This shell is `com.gotaxation.suite`.

Auth, uploads, OCR and ledgers stay on the Suite Render service. This
folder only packages a WebView + Play Store / sideload build.

## Prerequisites

- Node 20+
- Android Studio (Android SDK + a device or emulator)
- For iOS: a Mac with Xcode — `npx cap sync ios && npx cap open ios`.
  Camera / export-compliance keys are already in `ios/App/App/Info.plist`.

## Quick start (Android)

```bash
cd mobile-suite
npm install
npx cap sync android
npx cap open android
```

Set `CORS_ALLOW_CAPACITOR=1` on the Suite Render service (Blueprint default)
so session cookies work (`SameSite=None; Secure`).

## Play Store / TestFlight

See [`docs/store-listing.md`](../docs/store-listing.md). Signing keys and
store consoles are not in this repo. Subscriptions stay on the **website**
(Stripe) — do not wire in-app checkout in this shell.

## Store / launcher icon

Navy document mark (sky fold). Masters and a regenerate script:

- `store/icon-play-512.png` — Play high-res
- `store/icon-appstore-1024.png` — App Store (opaque)
- `store/feature-graphic-1024x500.png` — Play feature graphic
- `store/screenshots/` — Play 1080×1920 and App Store 1290×2796 phone shots
- `store/icon.svg` — source
- `python3 store/generate-icons.py` — writes icons, feature graphic, iOS AppIcon

## Honest store copy

Record receipts and prepare Australian tax working papers. Not tax advice
and not an official ATO lodgement.
