import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();
const db = getFirestore();
const region = "asia-south1";
const otpSecret = defineSecret("DRIVER_OTP_HMAC_SECRET");
const emailApiKey = defineSecret("DRIVER_EMAIL_API_KEY");
const emailFrom = defineSecret("DRIVER_EMAIL_FROM");
const otpCollection = "_privateDriverOtps";

function requiredString(value: unknown, name: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `${name} is required.`);
  const cleaned = value.trim();
  if (cleaned.length < minLength || cleaned.length > maxLength) {
    throw new HttpsError("invalid-argument", `${name} is invalid.`);
  }
  return cleaned;
}

function normalizeEmail(value: unknown): string {
  const email = requiredString(value, "Email", 6, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  return email;
}

function otpDigest(email: string, code: string): Buffer {
  return createHmac("sha256", otpSecret.value()).update(`${email}:${code}`).digest();
}

function matchesOtp(email: string, code: string, stored: string): boolean {
  const candidate = otpDigest(email, code);
  const expected = Buffer.from(stored, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function ensureDriver(request: { auth?: { uid: string; token: Record<string, unknown> } | null }): string {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.role !== "driver") {
    throw new HttpsError("unauthenticated", "Sign in as a driver to continue.");
  }
  return uid;
}

async function driverRef(uid: string) {
  const ref = db.collection("drivers").doc(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("failed-precondition", "Driver profile is not available.");
  return { ref, data: snapshot.data()! };
}

export const requestDriverOtp = onCall(
  { region, secrets: [otpSecret, emailApiKey, emailFrom] },
  async (request) => {
    const data = request.data as Record<string, unknown>;
    const email = normalizeEmail(data.email);
    const fullName = requiredString(data.fullName, "Name", 2, 100);
    const callerIp = request.rawRequest.ip ?? "unknown";
    const ipId = createHmac("sha256", otpSecret.value()).update(`ip:${callerIp}`).digest("hex");
    const ipRef = db.collection("_privateDriverOtpIpLimits").doc(ipId);
    const ipDecision = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ipRef);
      const saved = current.data();
      const createdAt = saved?.createdAt as Timestamp | undefined;
      const now = Timestamp.now();
      const count = createdAt && now.toMillis() - createdAt.toMillis() < 60 * 60_000
        ? Number(saved?.count ?? 0)
        : 0;
      if (count >= 10) return false;
      transaction.set(ipRef, {
        count: count + 1,
        createdAt: count ? createdAt : now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + 60 * 60_000),
      });
      return true;
    });
    if (!ipDecision) throw new HttpsError("resource-exhausted", "Too many verification requests. Try again later.");

    try {
      await getAuth().getUserByEmail(email);
      throw new HttpsError("already-exists", "An account already uses this email address.");
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    }

    const ref = db.collection(otpCollection).doc(createHmac("sha256", otpSecret.value()).update(email).digest("hex"));
    const now = Timestamp.now();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const hash = otpDigest(email, code).toString("hex");
    const canSend = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      const previous = current.data();
      const createdAt = previous?.createdAt as Timestamp | undefined;
      const lastSentAt = previous?.lastSentAt as Timestamp | undefined;
      const recentSendCount = createdAt && now.toMillis() - createdAt.toMillis() < 30 * 60_000
        ? Number(previous?.sendCount ?? 0)
        : 0;
      if (lastSentAt && now.toMillis() - lastSentAt.toMillis() < 60_000) return "cooldown";
      if (recentSendCount >= 5) return "limit";
      transaction.set(ref, {
        email,
        fullName,
        otpHash: hash,
        attempts: 0,
        sendCount: recentSendCount + 1,
        createdAt: recentSendCount ? createdAt : now,
        lastSentAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + 10 * 60_000),
        claimed: false,
      });
      return "sent";
    });
    if (canSend === "cooldown") throw new HttpsError("resource-exhausted", "Please wait a minute before requesting another code.");
    if (canSend === "limit") throw new HttpsError("resource-exhausted", "Too many codes requested. Try again in 30 minutes.");

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${emailApiKey.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom.value(),
          to: email,
          subject: "Your Rishiides Driver verification code",
          text: `Hi ${fullName}, your Rishiides Driver verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
          html: `<p>Hi ${fullName},</p><p>Your Rishiides Driver verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Email provider responded with ${response.status}`);
    } catch (error) {
      await ref.delete();
      console.error("Driver OTP email delivery failed", error);
      throw new HttpsError("unavailable", "Verification email could not be sent. Please try again.");
    }
    return { sent: true, expiresInSeconds: 600, resendAfterSeconds: 60 };
  },
);

export const verifyDriverOtp = onCall(
  { region, secrets: [otpSecret] },
  async ({ data }) => {
    const email = normalizeEmail(data.email);
    const otp = requiredString(data.otp, "Verification code", 6, 6);
    if (!/^\d{6}$/.test(otp)) throw new HttpsError("invalid-argument", "Enter the six-digit verification code.");
    const fullName = requiredString(data.fullName, "Name", 2, 100);
    const phone = requiredString(data.phone, "Mobile number", 13, 13);
    if (!/^\+91[6-9]\d{9}$/.test(phone)) throw new HttpsError("invalid-argument", "Enter a valid Indian mobile number.");
    const password = requiredString(data.password, "Password", 12, 128);
    const vehicleType = requiredString(data.vehicleType, "Vehicle type", 3, 4);
    if (!["car", "bike", "auto"].includes(vehicleType)) throw new HttpsError("invalid-argument", "Vehicle type is invalid.");
    const vehicleNumber = requiredString(data.vehicleNumber, "Vehicle registration", 5, 20).toUpperCase();
    const vehicleModel = requiredString(data.vehicleModel, "Vehicle model", 2, 60);
    const vehicleColour = requiredString(data.vehicleColour, "Vehicle colour", 2, 40);
    const licenseNumber = requiredString(data.licenseNumber, "Licence number", 4, 40).toUpperCase();
    const aadhaarNumber = requiredString(data.aadhaarNumber, "Aadhaar number", 12, 12);
    if (!/^\d{12}$/.test(aadhaarNumber)) throw new HttpsError("invalid-argument", "Enter a valid 12-digit Aadhaar number.");

    const otpId = createHmac("sha256", otpSecret.value()).update(email).digest("hex");
    const otpRef = db.collection(otpCollection).doc(otpId);
    const claimId = randomUUID();
    const now = Timestamp.now();
    const decision = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(otpRef);
      if (!snapshot.exists) return "missing";
      const saved = snapshot.data()!;
      if ((saved.expiresAt as Timestamp).toMillis() <= now.toMillis()) return "expired";
      if (Number(saved.attempts) >= 5) return "locked";
      if (!matchesOtp(email, otp, String(saved.otpHash))) {
        transaction.update(otpRef, { attempts: Number(saved.attempts) + 1 });
        return "incorrect";
      }
      if (saved.claimed) return "claimed";
      transaction.update(otpRef, { claimed: true, claimId });
      return "valid";
    });
    if (decision === "incorrect") throw new HttpsError("invalid-argument", "That code is not correct.");
    if (decision === "locked") throw new HttpsError("resource-exhausted", "Too many incorrect codes. Request a new one.");
    if (decision === "expired" || decision === "missing") throw new HttpsError("deadline-exceeded", "Request a new verification code.");
    if (decision === "claimed") throw new HttpsError("aborted", "This verification code is already being used.");

    let uid: string | undefined;
    try {
      const created = await getAuth().createUser({
        email,
        password,
        displayName: fullName,
        phoneNumber: phone,
        emailVerified: true,
      });
      uid = created.uid;
      await getAuth().setCustomUserClaims(uid, { role: "driver" });
      await db.collection("drivers").doc(uid).create({
        uid,
        fullName,
        email,
        phone,
        vehicleType,
        vehicleNumber,
        vehicleModel,
        vehicleColour,
        profileStatus: "pending",
        availabilityStatus: "offline",
        registrationComplete: false,
        completedRides: 0,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      const customToken = await getAuth().createCustomToken(uid, { role: "driver" });
      await otpRef.delete();
      return { uid, customToken };
    } catch (error) {
      if (uid) {
        await db.collection("drivers").doc(uid).delete().catch((cleanupError) => console.error("Failed to clean up incomplete driver profile", cleanupError instanceof Error ? cleanupError.name : "UnknownError"));
        await getAuth().deleteUser(uid).catch((cleanupError) => console.error("Failed to clean up incomplete driver account", cleanupError instanceof Error ? cleanupError.name : "UnknownError"));
      }
      await otpRef.update({ claimed: false, claimId: null }).catch((cleanupError) => console.error("Failed to release OTP claim", cleanupError instanceof Error ? cleanupError.name : "UnknownError"));
      if ((error as { code?: string }).code === "auth/email-already-exists" || (error as { code?: string }).code === "auth/phone-number-already-exists") {
        throw new HttpsError("already-exists", "An account already uses these details.");
      }
      console.error("Driver account creation failed", error instanceof Error ? error.name : "UnknownError");
      throw new HttpsError("internal", "Your driver account could not be created. Please try again.");
    }
  },
);

export const finalizeDriverRegistration = onCall(
  { region },
  async (request) => {
    const uid = ensureDriver(request);
    const payload = request.data as Record<string, unknown>;
    if (payload.uid !== uid) throw new HttpsError("permission-denied", "You can only finalize your own registration.");
    const paths = payload.paths;
    if (typeof paths !== "object" || paths === null) throw new HttpsError("invalid-argument", "Verification images are required.");
    const licenseNumber = requiredString(payload.licenseNumber, "Licence number", 4, 40).toUpperCase();
    const aadhaarNumber = requiredString(payload.aadhaarNumber, "Aadhaar number", 12, 12);
    if (!/^\d{12}$/.test(aadhaarNumber)) throw new HttpsError("invalid-argument", "Enter a valid 12-digit Aadhaar number.");
    const vehicleType = requiredString(payload.vehicleType, "Vehicle type", 3, 4);
    const vehicleNumber = requiredString(payload.vehicleNumber, "Vehicle registration", 5, 20).toUpperCase();
    const vehicleModel = requiredString(payload.vehicleModel, "Vehicle model", 2, 60);
    const vehicleColour = requiredString(payload.vehicleColour, "Vehicle colour", 2, 40);
    const { ref, data } = await driverRef(uid);
    if (data.registrationComplete) throw new HttpsError("already-exists", "Registration has already been submitted.");
    if (data.vehicleType !== vehicleType || data.vehicleNumber !== vehicleNumber
        || data.vehicleModel !== vehicleModel || data.vehicleColour !== vehicleColour) {
      throw new HttpsError("failed-precondition", "Vehicle details do not match the verified account.");
    }
    const requiredImages = ["licenseFront", "licenseBack", "aadhaarFront", "aadhaarBack", "profilePhoto", "vehiclePhoto"];
    const imagePaths = Object.fromEntries(requiredImages.map((name) => {
      const path = (paths as Record<string, unknown>)[name];
      if (path !== `drivers/${uid}/verification/${name}`) {
        throw new HttpsError("invalid-argument", "A verification image path is invalid.");
      }
      return [name, path];
    }));
    const bucket = getStorage().bucket();
    await Promise.all(Object.values(imagePaths).map(async (path) => {
      const [metadata] = await bucket.file(String(path)).getMetadata().catch(() => {
        throw new HttpsError("failed-precondition", "All verification images must finish uploading before submission.");
      });
      if (!metadata.contentType?.match(/^image\/(jpeg|png|webp|heic)$/) || Number(metadata.size) > 10 * 1024 * 1024) {
        throw new HttpsError("failed-precondition", "A verification image has an unsupported format or size.");
      }
    }));
    await ref.collection("private").doc("verification").set({
      licenseNumber,
      aadhaarNumber,
      imagePaths,
      vehicleType,
      vehicleNumber,
      vehicleModel,
      vehicleColour,
      submittedAt: Timestamp.now(),
    });
    await ref.update({
      profileImagePath: imagePaths.profilePhoto,
      registrationComplete: true,
      updatedAt: Timestamp.now(),
    });
    return { submitted: true };
  },
);

export const setDriverAvailability = onCall({ region }, async (request) => {
  const uid = ensureDriver(request);
  if (typeof request.data.online !== "boolean") throw new HttpsError("invalid-argument", "Availability must be on or off.");
  const ref = db.collection("drivers").doc(uid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const driver = snapshot.data();
    if (!driver?.registrationComplete || driver.profileStatus !== "approved") {
      throw new HttpsError("failed-precondition", "Driver approval is required before going online.");
    }
    if (request.data.online) {
      if (driver.availabilityStatus === "on_ride") throw new HttpsError("failed-precondition", "Finish the active ride first.");
      transaction.update(ref, { availabilityStatus: "online", updatedAt: Timestamp.now() });
    } else {
      if (driver.availabilityStatus === "on_ride") {
        throw new HttpsError("failed-precondition", "Complete or cancel the active ride before going offline.");
      }
      transaction.update(ref, { availabilityStatus: "offline", updatedAt: Timestamp.now() });
      transaction.delete(db.collection("driverLocations").doc(uid));
    }
  });
  return { updated: true };
});

export const acceptRide = onCall({ region }, async (request) => {
  const uid = ensureDriver(request);
  const rideId = requiredString(request.data.rideId, "Ride", 1, 128);
  const driver = db.collection("drivers").doc(uid);
  const ride = db.collection("rides").doc(rideId);
  await db.runTransaction(async (transaction) => {
    const [driverSnapshot, rideSnapshot] = await Promise.all([transaction.get(driver), transaction.get(ride)]);
    const driverData = driverSnapshot.data();
    const rideData = rideSnapshot.data();
    if (!driverData?.registrationComplete || driverData.profileStatus !== "approved" || driverData.availabilityStatus !== "online") {
      throw new HttpsError("failed-precondition", "You must be approved and online to accept rides.");
    }
    if (!rideSnapshot.exists || rideData?.status !== "requested") {
      throw new HttpsError("aborted", "This ride is no longer available.");
    }
    transaction.update(ride, {
      driverUid: uid,
      status: "accepted",
      acceptedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    transaction.update(driver, { availabilityStatus: "on_ride", updatedAt: Timestamp.now() });
  });
  return { accepted: true };
});

export const updateRideStatus = onCall({ region }, async (request) => {
  const uid = ensureDriver(request);
  const rideId = requiredString(request.data.rideId, "Ride", 1, 128);
  const nextStatus = requiredString(request.data.status, "Ride status", 3, 20);
  const rideRef = db.collection("rides").doc(rideId);
  const driverRef = db.collection("drivers").doc(uid);
  await db.runTransaction(async (transaction) => {
    const [rideSnapshot, driverSnapshot] = await Promise.all([transaction.get(rideRef), transaction.get(driverRef)]);
    const ride = rideSnapshot.data();
    if (!rideSnapshot.exists || ride?.driverUid !== uid) throw new HttpsError("not-found", "Ride not found.");
    const allowed: Record<string, string[]> = {
      accepted: ["driver_arriving", "cancelled"],
      driver_arriving: ["in_progress", "cancelled"],
      in_progress: ["completed"],
    };
    if (!allowed[String(ride.status)]?.includes(nextStatus)) {
      throw new HttpsError("failed-precondition", "This ride status change is not allowed.");
    }
    transaction.update(rideRef, { status: nextStatus, updatedAt: Timestamp.now() });
    if (nextStatus === "completed" || nextStatus === "cancelled") {
      transaction.update(driverRef, {
        availabilityStatus: "online",
        completedRides: nextStatus === "completed" ? Number(driverSnapshot.data()?.completedRides ?? 0) + 1 : Number(driverSnapshot.data()?.completedRides ?? 0),
        updatedAt: Timestamp.now(),
      });
    }
  });
  return { updated: true };
});

export const updateDriverLocation = onCall({ region }, async (request) => {
  const uid = ensureDriver(request);
  const latitude = Number(request.data.latitude);
  const longitude = Number(request.data.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpsError("invalid-argument", "Location coordinates are invalid.");
  }
  const profileRef = db.collection("drivers").doc(uid);
  const locationRef = db.collection("driverLocations").doc(uid);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const [profileSnapshot, locationSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(locationRef),
    ]);
    const driver = profileSnapshot.data();
    if (!driver?.registrationComplete || driver.profileStatus !== "approved"
        || !["online", "on_ride"].includes(String(driver.availabilityStatus))) {
      throw new HttpsError("failed-precondition", "Location sharing is available only while approved and working.");
    }
    const previous = locationSnapshot.data();
    const lastUpdate = previous?.updatedAt as Timestamp | undefined;
    if (lastUpdate && now.toMillis() - lastUpdate.toMillis() < 15_000) return;
    transaction.set(locationRef, {
      latitude,
      longitude,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 10 * 60_000),
    });
  });
  return { updated: true };
});

export const registerDriverPushToken = onCall({ region }, async (request) => {
  const uid = ensureDriver(request);
  const token = requiredString(request.data.token, "Push token", 20, 4096);
  await db.collection("drivers").doc(uid).collection("private").doc("pushTokens").set({
    tokens: { [createHash("sha256").update(token).digest("hex")]: token },
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return { registered: true };
});

export const notifyDriversOfRide = onDocumentCreated(
  { document: "rides/{rideId}", region },
  async (event) => {
    const ride = event.data?.data();
    if (!ride || ride.status !== "requested") return;
    const onlineDrivers = await db.collection("drivers")
      .where("profileStatus", "==", "approved")
      .where("availabilityStatus", "==", "online")
      .where("registrationComplete", "==", true)
      .limit(500)
      .get();
    const tokens: string[] = [];
    for (const driver of onlineDrivers.docs) {
      const saved = await driver.ref.collection("private").doc("pushTokens").get();
      const record = saved.data()?.tokens;
      if (record && typeof record === "object") tokens.push(...Object.values(record).filter((value): value is string => typeof value === "string"));
    }
    if (!tokens.length) return;
    const result = await getMessaging().sendEachForMulticast({
      tokens: [...new Set(tokens)].slice(0, 500),
      notification: { title: "New ride request", body: String(ride.pickup ?? "A nearby pickup") },
      data: { rideId: event.params.rideId },
      android: { priority: "high", notification: { channelId: "driver-rides" } },
    });
    if (result.failureCount) console.warn("Some driver ride notifications could not be delivered", result.failureCount);
  },
);
