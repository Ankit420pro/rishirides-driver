# Rishiides Driver Firebase setup

The mobile app targets Expo SDK 58 and the `asia-south1` Firebase Functions region.

## Firebase project

1. Create a Firebase project and register an Android app with package name `com.rishiides.driver`.
2. Enable Email/Password and Google in Authentication > Sign-in method.
3. Create a Cloud Firestore database and a Cloud Storage bucket.
4. Enable Cloud Messaging. Download the Android `google-services.json` and keep it outside version control.
5. Add the SHA-1 fingerprints for each Android signing certificate (development and release/EAS) to the Android app in Firebase project settings, then download a fresh `google-services.json`.
6. In Google Cloud Console, find or create a Web OAuth client ID for this Firebase project. Set it as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; do not use the Android OAuth client ID for this value.
7. Enable the Google Maps SDK for Android and create a restricted Android Maps API key.
8. Copy `mobile/.env.example` to `mobile/.env` and fill in the Firebase web app settings, Google Web OAuth client ID, and Maps key. Set `GOOGLE_SERVICES_JSON_PATH` to the downloaded file for native Android builds. For iOS, also register the bundle ID and set `GOOGLE_SERVICES_PLIST_PATH`.
9. Deploy Firestore and Storage rules and the Cloud Functions from the repository root:

   ```sh
   firebase use YOUR_FIREBASE_PROJECT_ID
   cd functions && npm install && cd ..
   firebase deploy --only firestore:rules,firestore:indexes,storage,functions
   ```

The Firebase web API key is public client configuration, not an authorization secret. Restrict its API usage in Google Cloud. Never commit service account keys, `google-services.json`, SMTP credentials, or `.env`.

## Email verification secrets

The OTP is six digits, held only in server memory while sending, and stored as an HMAC digest in the `_privateDriverOtps` collection. Firestore rules deny all client access to that collection. It expires after ten minutes, allows five attempts, and requests are limited to one per minute and five per 30 minutes per email. Create a Resend account, verify your sender domain, and configure its API token through Firebase Secret Manager:

```sh
firebase functions:secrets:set DRIVER_OTP_HMAC_SECRET
firebase functions:secrets:set DRIVER_EMAIL_API_KEY
firebase functions:secrets:set DRIVER_EMAIL_FROM
```

Use a long, randomly generated `DRIVER_OTP_HMAC_SECRET` and set `DRIVER_EMAIL_FROM` to a sender verified with Resend. Deploy Functions again after changing a secret.

## Data and privacy

Cloud Functions own driver profile writes, availability changes, ride assignment/status changes, driver location, and push tokens. The app can read only its own public driver profile, requested rides while approved and online, and rides assigned to that driver. Identity numbers and verification image paths are stored in the server-only `drivers/{uid}/private/verification` document. Storage rules limit image uploads to the authenticated driver's own verification directory and cap images at 10 MiB.

Ride documents in `rides/{rideId}` must contain only information safe to show to eligible drivers (for example pickup, destination, fare, status, and assignment). Put passenger contact details in `rides/{rideId}/private/passenger`; only the assigned driver can read that subcollection. The ride-request notification trigger expects new ride documents to start with `status: "requested"`.

## Android build and notifications

Google sign-in and `expo-notifications` need a native development/production build; neither is available in Expo Go. The Google sign-in config plugin adds its native Android/iOS dependencies during prebuild. After setting the OAuth client ID and Firebase native config, rebuild the app (for example with `npx expo run:android` or EAS Build); do not manually add Firebase or Play Services dependencies to generated Gradle files.

Google sign-in is a login option for drivers who already have a driver profile and a Google-linked Firebase Auth account. Driver registration continues to use the email OTP flow. Existing drivers can sign in with email/password and use **Link Google sign-in** from the dashboard to link their Google account. An account with no driver profile is not allowed into the dashboard.

The app requests foreground location only and sends location while online or on an active ride; configure a separate background-location disclosure and native background task before enabling background tracking.
