# Rishiides Driver Firebase setup

The mobile app and Functions target Expo SDK 54 and the `asia-south1` Firebase Functions region.

## Firebase project

1. Create a Firebase project and register an Android app with package name `com.rishiides.driver`.
2. Enable Email/Password in Authentication.
3. Create a Cloud Firestore database and a Cloud Storage bucket.
4. Enable Cloud Messaging. Download the Android `google-services.json` and keep it outside version control.
5. Enable the Google Maps SDK for Android and create a restricted Android Maps API key.
6. Copy `mobile/.env.example` to `mobile/.env` and fill in the Firebase web app settings and Maps key. Set `GOOGLE_SERVICES_JSON_PATH` to the downloaded file for native Android builds.
7. Deploy Firestore and Storage rules and the Cloud Functions from the repository root:

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

`expo-notifications` needs a native development/production build and the project's Android Firebase configuration; Expo Go does not provide production FCM behavior. Run `npx expo prebuild` and an EAS or local Android build after adding the project config. The app requests foreground location only and sends location while online or on an active ride; configure a separate background-location disclosure and native background task before enabling background tracking.
