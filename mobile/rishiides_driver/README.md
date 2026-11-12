# Rishiides Driver (Android)

Flutter Android starter app with Firebase Authentication, Firestore, Storage, callable email-OTP functions, Google Maps, live driver GPS updates, nearby ride requests and completed-ride earnings.

## Important integration contract with the Rishiides passenger app

This app expects the passenger app/backend to use the same Firebase project and these Firestore documents:

- `drivers/{driverUid}`: private driver profile, contact details, document URLs and `status` (`pending_approval` then `approved` by an admin). This document is readable only by the driver.
- `publicDrivers/{driverUid}`: passenger-safe public fields (`name`, `status`, `isOnline`, `location` GeoPoint). Passenger app listens here for the driver's live map marker; never put document URLs or Aadhaar data here.
- `rides/{rideId}`: `status` (`requested`, `accepted`, `arrived`, `in_progress`, `completed`, `cancelled`), `passengerId`, `pickup` (GeoPoint), `pickupAddress`, `fare`, `driverId`, `driverEarning`.
- Passenger app should listen to the assigned ride and the referenced driver's `location` field to show the driver marker. Driver app listens to `rides` where `status == requested` and locally filters pickups within 10 km.

The passenger app must create ride documents using the above schema and must use the same Firebase project. Before production, move ride acceptance and all status transitions into trusted Cloud Functions so clients cannot manipulate fare or other ride fields.

## Setup

1. Install Flutter SDK, Android Studio and Node.js 20.
2. Generate the standard Android Gradle/launcher scaffolding in this source folder: `flutter create --platforms=android --org com.rishiides .` (keep the provided `lib/`, `pubspec.yaml` and `android/app/src/main/AndroidManifest.xml` changes if the generator asks about overwriting). This deliverable is source code, not a prebuilt APK.
3. Create/select the Firebase project used by the Rishiides passenger app.
4. In this folder run:
   ```bash
   flutter pub get
   dart pub global activate flutterfire_cli
   flutterfire configure
   ```
   Register the Android app with your real application ID. Download the matching `google-services.json` into `android/app/`. Add the Google Services Gradle plugin following the current FlutterFire setup instructions. The generated `firebase_options.dart` can be used by changing `main.dart` to `Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform)` and importing it.
5. Add your Google Maps Android API key in `android/app/src/main/AndroidManifest.xml` in place of `YOUR_GOOGLE_MAPS_ANDROID_API_KEY`. Restrict the key to your Android package and signing certificate.
6. Deploy rules and functions:
   ```bash
   firebase login
   firebase use YOUR_FIREBASE_PROJECT_ID
   firebase deploy --only firestore:rules,storage,functions
   ```
7. Set SMTP secrets for email OTP (use a transactional email provider or your organization's SMTP account):
   ```bash
   firebase functions:secrets:set SMTP_HOST
   firebase functions:secrets:set SMTP_PORT
   firebase functions:secrets:set SMTP_USER
   firebase functions:secrets:set SMTP_PASS
   firebase functions:secrets:set OTP_SECRET
   ```
   Use a long random OTP_SECRET. Enable Firebase App Check and configure the Android app before invoking the callable functions because enforcement is enabled.
8. In Firebase Authentication enable Email/Password sign-in. Set up an admin-only process to review documents and change `drivers/{uid}.status` to `approved`.
9. Build: `flutter build apk --release`.

## Notes / production work required

- Firebase Authentication does not provide a native six-digit email OTP flow. This project implements one with callable Cloud Functions and SMTP. The OTP is hashed, expires after 10 minutes, has a five-attempt limit, and resend cooldown. Add stronger per-IP/device abuse controls and email-provider delivery monitoring before launch.
- Aadhaar is highly sensitive personal data. Do not collect or retain Aadhaar unless you have a lawful basis and explicit consent. Prefer masked Aadhaar or an approved identity-verification provider; encrypt and strictly limit document access, define retention/deletion, and obtain legal/privacy review. The sample Storage rules allow only the driver to read their own uploads; build a secure admin verification workflow separately.
- Android foreground/background location service, persistent notification, background execution permissions and Play policy declarations are not included. Current tracking updates while the app process is active. Implement a compliant foreground service for background ride tracking before production.
- The earnings card currently totals completed rides. For daily/weekly/monthly summaries, add server-generated payout/earning aggregates and date filters.
- Ride acceptance is transactional in the client, but production should use a callable backend to validate driver approval, proximity, ride state, and prevent races/abuse. Add indexes as prompted by Firestore.
- Add passenger live-location sharing (passenger writes `rides/{rideId}.passengerLocation`) and driver active-ride navigation/arrived/start/complete UI as part of the shared ride lifecycle. The current starter writes driver GPS to `drivers/{uid}.location` for the passenger app to observe.

## Project layout

- `lib/`: Flutter UI and Firebase services
- `functions/src/index.ts`: email OTP callables
- `firestore.rules`, `storage.rules`: baseline access rules
