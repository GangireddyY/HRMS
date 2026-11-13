# Phone app (Android and iOS)

The store app is a [Capacitor](https://capacitorjs.com) shell around the hosted HRMS web app. It loads `HRMS_APP_URL`
(your HRMS site), so sign-in cookies stay first-party and every web deploy reaches phones without a store release.
What the app adds over the browser:

| | Browser / installed web app | Phone app |
|---|---|---|
| Notifications | Web Push (VAPID), per browser | Native push: Android through Firebase Cloud Messaging, iOS through APNs; registered on sign-in, removed on sign-out |
| Punch-in location | Geolocation API | OS location permission prompt (`@capacitor/geolocation`) |
| Links | Open in the browser | Links to the HRMS site and notification taps open in the app |
| Back | Browser back | Android back button navigates back, then minimizes |
| Offline | Service worker | The same service worker (iOS: the site is an app-bound domain) |

The bridge is `frontend/src/core/native/native.ts` (platform, safe in-app paths, location) and
`frontend/src/app/native-app.ts` (back button, links, push). In a browser both do nothing.

## Build

Prerequisites: Node 22; Android Studio (JDK 21, Android SDK) for Android; a Mac with Xcode 16+ for iOS.

```bash
cd frontend
npm ci
HRMS_APP_URL=https://hrms.example.com npx cap sync      # writes the URL into both native projects
npm run app:android                                     # opens Android Studio
npm run app:ios                                         # opens Xcode
```

`native-shell/` is the only bundled page (shown when a build has no `HRMS_APP_URL`). Set
`CAPACITOR_REQUIRE_URL=true` in release pipelines so a build without the URL fails. `HRMS_APP_ID` changes the
application id / bundle id (default `com.nitya.hrms`).

### Android

Release builds read signing and version from Gradle properties, `android/keystore.properties` or the environment
(never committed):

```properties
HRMS_HOST=hrms.example.com
HRMS_VERSION_CODE=12
HRMS_VERSION_NAME=1.13.0
HRMS_KEYSTORE_FILE=/secure/hrms-upload.jks
HRMS_KEYSTORE_PASSWORD=…
HRMS_KEY_ALIAS=hrms
HRMS_KEY_PASSWORD=…
```

```bash
cd frontend/android && ./gradlew bundleRelease     # app/build/outputs/bundle/release/app-release.aab for Play
```

CI builds an unsigned debug APK on every run (`android` job) and uploads it as an artifact.

### iOS

In Xcode: set the team, then add the **Push Notifications** and **Associated Domains** capabilities
(`applinks:hrms.example.com`). `HRMS_HOST` (the app-bound domain, `debug.xcconfig`) must be your site's host; for
archives pass it to `xcodebuild … HRMS_HOST=hrms.example.com` or set it in the Release build settings. CI compiles
the project for the simulator on pushes to `main` (`ios` job).

## Notifications

The server sends to each platform only when that platform is configured; the app checks
`GET /notifications/push` (`nativePlatforms`) before asking for permission.

- **Android (Firebase):** create a Firebase project with the app's id, download `google-services.json` into
  `frontend/android/app/` (ignored by git) before building, and give the API a service-account key with the Firebase
  Cloud Messaging API enabled: `FCM_CREDENTIALS_FILE=/run/secrets/fcm.json`.
- **iOS (APNs):** create an APNs key in Apple Developer → Keys and set `APNS_KEY_FILE` (the `.p8`), `APNS_KEY_ID`,
  `APNS_TEAM_ID` and `APNS_TOPIC` (the bundle id). `APNS_PRODUCTION=false` for development builds signed with a
  development profile.

Pushes follow each person's notification settings (categories, the push switch), are sent through the job queue,
carry no grievance details, and devices the push service reports gone are removed.

## Links that open in the app

Serve the two verification files from the site. The frontend image serves `/.well-known/` from
`/usr/share/nginx/.well-known` (mount a directory there); they are 404 when absent.

`assetlinks.json` (Android; the SHA-256 is the app signing certificate from Play Console → App integrity):

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.nitya.hrms", "sha256_cert_fingerprints": ["AB:CD:…"] } }]
```

`apple-app-site-association` (iOS; no extension, served as JSON):

```json
{ "applinks": { "details": [{ "appIDs": ["TEAMID.com.nitya.hrms"], "components": [{ "/": "/*" }] }] } }
```

## Store review notes

- The app uses native push, location permission, the camera (selfie punch when the organization asks) and deep links,
  which App Store guideline 4.2 expects of a web-content app.
- Privacy labels: location (attendance, linked to the user), photos (attendance selfie), contact info and employment
  data held by the employer. Nothing is used for tracking or advertising.
