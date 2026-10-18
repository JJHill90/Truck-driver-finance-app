# Driver Hub — mobile shell (Capacitor)

Native Android wrapper around the **hosted app** at
`https://www.godriverhub.com/haulage/` — the Driver Hub login service, not the
public marketing site at `https://godriverhub.com/` and not
`www.gotaxation.com.au` (that name does not resolve).

Open **this** project in Android Studio: `mobile/android` after `npx cap sync android`
from `mobile/`. Application id is `com.haulagefinance.app`. Do **not** open
`mobile-suite/` or a local `comgotaxationsuite` folder — that is Go Taxation Suite.

The phone loads the same Render site you already use in the browser. Auth,
uploads, OCR, and ledgers stay on the server — this folder only packages a
WebView + Play Store build.

Do **not** set Capacitor `server.url`. The WebView loads the hosted URL from
`MainActivity` (same crash-safe pattern as Go Taxation Suite). Official
marketing / Privacy / Terms / Support: see
[`docs/store-listing-driverhub.md`](../docs/store-listing-driverhub.md) and
[`docs/custom-domain-driverhub.md`](../docs/custom-domain-driverhub.md).

## Prerequisites

- Node 20+
- [Android Studio](https://developer.android.com/studio) (Android SDK + a device
  or emulator)

## Quick start (Android)

```bash
cd mobile
npm install
npx cap sync android
npx cap open android
```

In Android Studio: pick a device → **Run**. Then **Build → Generate Signed
Bundle** for Play (`versionCode` 3 / `1.0.2`). Keep the keystore out of git.

Store listing copy, Data safety answers, and reviewer notes:
[`docs/store-listing-driverhub.md`](../docs/store-listing-driverhub.md).

Regenerate icons / feature graphic:

```bash
python3 -m pip install Pillow
python3 mobile/store/generate-icons.py
```

## Why remote URL (not bundling `public/`)

- One deploy on Render updates every installed shell immediately.
- Same cookies / session as the mobile browser you already verified.
- No separate mobile API contract.

`www/index.html` is only a short fallback if the remote URL cannot load.

## Plugins installed

| Package | Purpose |
|---------|---------|
| `@capacitor/app` | Lifecycle / back button |
| `@capacitor/camera` | Optional native camera (web file picker still works) |
| `@capacitor/filesystem` | Optional local file helpers |

## iOS

On a Mac (Xcode + signing):

```bash
cd mobile
npx cap add ios
npx cap sync ios
```

Paste `ios-info.plist.additions.xml` into `ios/App/App/Info.plist`, then
`npx cap open ios`. App id: `com.haulagefinance.app`.

Go Taxation Suite is a **second listing** under `mobile-suite/`
(`com.gotaxation.suite` → `/suite/`). See `docs/store-listing.md`.
