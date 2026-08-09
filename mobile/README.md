# Haulage Finance — mobile shell (Capacitor)

Native Android (and later iOS) wrapper around the **hosted** web app at
`https://haulage-finance.onrender.com/haulage/`.

The phone loads the same Render site you already use in the browser. Auth,
uploads, OCR, and ledgers stay on the server — this folder only packages a
WebView + Play Store / sideload build.

## Prerequisites

- Node 20+
- [Android Studio](https://developer.android.com/studio) (Android SDK + a device
  or emulator)
- For iOS: a Mac with Xcode (not generated in this repo yet — run
  `npx cap add ios` on a Mac when ready)

## Quick start (Android)

```bash
cd mobile
npm install
npx cap sync android
npx cap open android
```

In Android Studio: pick a device → **Run**. The app opens the Render URL
(same-origin API, cookies work as in Chrome).

### Point at a different host

Edit `server.url` in `capacitor.config.json`, then:

```bash
npx cap sync android
```

Examples:

| Target | `server.url` |
|--------|----------------|
| Production (default) | `https://haulage-finance.onrender.com/haulage/` |
| Local LAN testing | `http://192.168.x.x:3000/haulage/` (`cleartext: true`) |

Local HTTP also needs `android:usesCleartextTraffic="true"` (or a network
security config) and, if the WebView origin differs from the API host, the
server CORS allowlist (`CORS_ORIGINS` / `CORS_ALLOW_CAPACITOR`) from PR #62.

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

Receipt scan in the SPA today uses the browser file input inside the WebView;
native Camera can be wired later without changing the backend.

## Play Store / internal testing

1. Device-test the debug APK from Android Studio.
2. Create a signing keystore (keep it out of git).
3. Build a release AAB: Android Studio → **Build → Generate Signed Bundle**.
4. Upload to Play Console → Internal testing track.
5. Keep `server.url` on production HTTPS before store builds.

## iOS (later)

On a Mac:

```bash
cd mobile
npx cap add ios
npx cap sync ios
npx cap open ios
```

Then TestFlight via Xcode / App Store Connect. App id:
`com.haulagefinance.app`.

## Repo layout

```
mobile/
  capacitor.config.json   # appId, remote server.url
  www/                    # offline fallback page
  android/                # native project (open in Android Studio)
  package.json            # Capacitor deps (separate from root app)
```

Do not commit `mobile/node_modules` or Android `build/` / `local.properties`
(ignored).
