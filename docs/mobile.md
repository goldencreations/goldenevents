# Mobile apps (Capacitor)

The web app is unchanged: `npm run build` still produces `dist/` for the
server. The mobile flavors wrap the same React UI in a Capacitor WebView and
call the same Express API.

## Flavors

| Flavor | Command | API base | Use |
| --- | --- | --- | --- |
| Web | `npm run build` | relative `/api` (same origin) | VPS/Docker — untouched |
| Bundled (store) | `npm run build:mobile` | `VITE_API_BASE_URL` from `.env.mobile` | Play Store / App Store APK-IPA |
| Remote (internal) | `CAP_SERVER_URL=https://goldencreations.events npm run build:mobile` | relative (live site origin) | QA builds that load the live site |

Store builds must always be **bundled** (never set `CAP_SERVER_URL` there).

## Local commands

```sh
npm run app:android        # build mobile web + sync + debug APK
npm run app:android:release # signed AAB/APK (needs keystore properties)
npm run app:ios:sync       # build mobile web + sync iOS project (build on macOS)
```

Debug APK output: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Versions

- Source of truth: `package.json` `"version"` (e.g. `0.1.0`).
- `scripts/sync-app-version.js` (runs inside `app:sync` and CI) writes:
  - Android `versionName` = package version, `versionCode` =
    `major*100000 + minor*1000 + patch*10 + build` (build from `VERSION_BUILD`,
    default 0 → `0.1.0` is code `1000`).
  - iOS `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` (both target configs).
- The Settings page shows `Golden Events vX (build)` inside the app.
- Release flow: bump `package.json` version → commit → tag `vX.Y.Z` (CI fails
  if tag ≠ package version) → CI builds and attaches AAB/APK to the GitHub
  Release.

## Server configuration (required for bundled builds)

On the VPS, in `.env.production`:

```
APP_SHELL_ORIGINS=https://localhost,capacitor://localhost
```

This allowlists the app WebView origins for CORS + the write-origin guard and
makes production session cookies `SameSite=None` (HTTPS-only, web behavior
otherwise unchanged). Leave it empty to disable app-shell access entirely.

## Android release signing

Generate once, keep offline:

```sh
keytool -genkeypair -v -keystore golden-release.keystore -alias golden \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 golden-release.keystore   # store as secret ANDROID_KEYSTORE_BASE64
```

GitHub secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Local signed build:

```sh
cd android
./gradlew bundleRelease \
  -PGOLDEN_KEYSTORE_FILE=/path/golden-release.keystore \
  -PGOLDEN_KEYSTORE_PASSWORD=... \
  -PGOLDEN_KEY_ALIAS=golden \
  -PGOLDEN_KEY_PASSWORD=...
```

## iOS

- Project: `ios/App` (scheme `App`, bundle id `events.goldencreation.app`).
- Camera/photo usage strings are already in `Info.plist`.
- CI (`.github/workflows/mobile.yml`) compiles the app unsigned on every PR.
- For signed IPAs set repository variable `IOS_SIGNING_ENABLED=true`,
  variable `IOS_TEAM_ID`, and secrets `IOS_CERTIFICATE_P12`,
  `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE`.
- iOS builds require macOS (local Mac or the CI runner) — not Windows.

## App identity

- Android application id / iOS bundle id: `events.goldencreation.app`
- Display name: `Golden Events`
- Icons/splash: generated from `assets/icon.png` (source:
  `public/assets/golden-ticket-symbol.png`) via `npx capacitor-assets generate
  --iconBackgroundColor "#147d65"`. Re-run after changing the icon.

## What runs where

- Bottom navigation (`src/BottomNav.tsx`, design from the provided HTML) is
  rendered only when `VITE_APP_SHELL=1` (mobile builds). Web keeps the
  hamburger sidebar.
- Organizer/Admin tabs: Home, Events, Orders, Revenue, More (opens the drawer).
- Scanner tabs: Scan, Settings.
- Ticket PNG / CSV exports use the native share sheet in the app
  (`src/shellSave.ts`); the web keeps browser downloads.

## Device test matrix (before each store submission)

- Screens: 360×640, 390×844, 412×915, 768×1024 (tablet).
- Login → session persists after app restart; logout everywhere.
- Bottom nav: all tabs per role, More drawer, safe-area padding, toast above bar.
- Event artwork upload + crop; QR camera scan + manual code fallback;
  checkout (demo/live); ticket PNG save; CSV export.
- Airplane mode: friendly error, no crash.

## Store checklist

Play Store: AAB from the tag release, target SDK ≥ current Play requirement,
data-safety form, privacy policy URL, 8 phone screenshots, Events category.
App Store: privacy nutrition labels, 6.7" screenshots, review notes with the
demo login, bundled flavor only (Guideline 4.2).
