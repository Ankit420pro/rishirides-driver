"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyDriversOfRide = exports.registerDriverPushToken = exports.updateDriverLocation = exports.updateRideStatus = exports.acceptRide = exports.setDriverAvailability = exports.finalizeDriverRegistration = exports.verifyDriverOtp = exports.requestDriverOtp = void 0;
const node_crypto_1 = require("node:crypto");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const storage_1 = require("firebase-admin/storage");
const firestore_2 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const region = "asia-south1";
const otpSecret = (0, params_1.defineSecret)("DRIVER_OTP_HMAC_SECRET");
const emailApiKey = (0, params_1.defineSecret)("DRIVER_EMAIL_API_KEY");
const emailFrom = (0, params_1.defineSecret)("DRIVER_EMAIL_FROM");
const otpCollection = "_privateDriverOtps";
function requiredString(value, name, minLength, maxLength) {
    if (typeof value !== "string")
        throw new https_1.HttpsError("invalid-argument", `${name} is required.`);
    const cleaned = value.trim();
    if (cleaned.length < minLength || cleaned.length > maxLength) {
        throw new https_1.HttpsError("invalid-argument", `${name} is invalid.`);
    }
    return cleaned;
}
function normalizeEmail(value) {
    const email = requiredString(value, "Email", 6, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new https_1.HttpsError("invalid-argument", "Enter a valid email address.");
    }
    return email;
}
function otpDigest(email, code) {
    return (0, node_crypto_1.createHmac)("sha256", otpSecret.value()).update(`${email}:${code}`).digest();
}
function matchesOtp(email, code, stored) {
    const candidate = otpDigest(email, code);
    const expected = Buffer.from(stored, "hex");
    return candidate.length === expected.length && (0, node_crypto_1.timingSafeEqual)(candidate, expected);
}
function ensureDriver(request) {
    const uid = request.auth?.uid;
    if (!uid || request.auth?.token.role !== "driver") {
        throw new https_1.HttpsError("unauthenticated", "Sign in as a driver to continue.");
    }
    return uid;
}
async function driverRef(uid) {
    const ref = db.collection("drivers").doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists)
        throw new https_1.HttpsError("failed-precondition", "Driver profile is not available.");
    return { ref, data: snapshot.data() };
}
exports.requestDriverOtp = (0, https_1.onCall)({ region, secrets: [otpSecret, emailApiKey, emailFrom] }, async (request) => {
    const data = request.data;
    const email = normalizeEmail(data.email);
    const fullName = requiredString(data.fullName, "Name", 2, 100);
    const callerIp = request.rawRequest.ip ?? "unknown";
    const ipId = (0, node_crypto_1.createHmac)("sha256", otpSecret.value()).update(`ip:${callerIp}`).digest("hex");
    const ipRef = db.collection("_privateDriverOtpIpLimits").doc(ipId);
    const ipDecision = await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ipRef);
        const saved = current.data();
        const createdAt = saved?.createdAt;
        const now = firestore_1.Timestamp.now();
        const count = createdAt && now.toMillis() - createdAt.toMillis() < 60 * 60_000
            ? Number(saved?.count ?? 0)
            : 0;
        if (count >= 10)
            return false;
        transaction.set(ipRef, {
            count: count + 1,
            createdAt: count ? createdAt : now,
            expiresAt: firestore_1.Timestamp.fromMillis(now.toMillis() + 60 * 60_000),
        });
        return true;
    });
    if (!ipDecision)
        throw new https_1.HttpsError("resource-exhausted", "Too many verification requests. Try again later.");
    try {
        await (0, auth_1.getAuth)().getUserByEmail(email);
        throw new https_1.HttpsError("already-exists", "An account already uses this email address.");
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        if (error.code !== "auth/user-not-found")
            throw error;
    }
    const ref = db.collection(otpCollection).doc((0, node_crypto_1.createHmac)("sha256", otpSecret.value()).update(email).digest("hex"));
    const now = firestore_1.Timestamp.now();
    const code = String((0, node_crypto_1.randomInt)(0, 1_000_000)).padStart(6, "0");
    const hash = otpDigest(email, code).toString("hex");
    const canSend = await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        const previous = current.data();
        const createdAt = previous?.createdAt;
        const lastSentAt = previous?.lastSentAt;
        const recentSendCount = createdAt && now.toMillis() - createdAt.toMillis() < 30 * 60_000
            ? Number(previous?.sendCount ?? 0)
            : 0;
        if (lastSentAt && now.toMillis() - lastSentAt.toMillis() < 60_000)
            return "cooldown";
        if (recentSendCount >= 5)
            return "limit";
        transaction.set(ref, {
            email,
            fullName,
            otpHash: hash,
            attempts: 0,
            sendCount: recentSendCount + 1,
            createdAt: recentSendCount ? createdAt : now,
            lastSentAt: now,
            expiresAt: firestore_1.Timestamp.fromMillis(now.toMillis() + 10 * 60_000),
            claimed: false,
        });
        return "sent";
    });
    if (canSend === "cooldown")
        throw new https_1.HttpsError("resource-exhausted", "Please wait a minute before requesting another code.");
    if (canSend === "limit")
        throw new https_1.HttpsError("resource-exhausted", "Too many codes requested. Try again in 30 minutes.");
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
        if (!response.ok)
            throw new Error(`Email provider responded with ${response.status}`);
    }
    catch (error) {
        await ref.delete();
        console.error("Driver OTP email delivery failed", error);
        throw new https_1.HttpsError("unavailable", "Verification email could not be sent. Please try again.");
    }
    return { sent: true, expiresInSeconds: 600, resendAfterSeconds: 60 };
});
exports.verifyDriverOtp = (0, https_1.onCall)({ region, secrets: [otpSecret] }, async ({ data }) => {
    const email = normalizeEmail(data.email);
    const otp = requiredString(data.otp, "Verification code", 6, 6);
    if (!/^\d{6}$/.test(otp))
        throw new https_1.HttpsError("invalid-argument", "Enter the six-digit verification code.");
    const fullName = requiredString(data.fullName, "Name", 2, 100);
    const phone = requiredString(data.phone, "Mobile number", 13, 13);
    if (!/^\+91[6-9]\d{9}$/.test(phone))
        throw new https_1.HttpsError("invalid-argument", "Enter a valid Indian mobile number.");
    const password = requiredString(data.password, "Password", 12, 128);
    const vehicleType = requiredString(data.vehicleType, "Vehicle type", 3, 4);
    if (!["car", "bike", "auto"].includes(vehicleType))
        throw new https_1.HttpsError("invalid-argument", "Vehicle type is invalid.");
    const vehicleNumber = requiredString(data.vehicleNumber, "Vehicle registration", 5, 20).toUpperCase();
    const vehicleModel = requiredString(data.vehicleModel, "Vehicle model", 2, 60);
    const vehicleColour = requiredString(data.vehicleColour, "Vehicle colour", 2, 40);
    const licenseNumber = requiredString(data.licenseNumber, "Licence number", 4, 40).toUpperCase();
    const aadhaarNumber = requiredString(data.aadhaarNumber, "Aadhaar number", 12, 12);
    if (!/^\d{12}$/.test(aadhaarNumber))
        throw new https_1.HttpsError("invalid-argument", "Enter a valid 12-digit Aadhaar number.");
    const otpId = (0, node_crypto_1.createHmac)("sha256", otpSecret.value()).update(email).digest("hex");
    const otpRef = db.collection(otpCollection).doc(otpId);
    const claimId = (0, node_crypto_1.randomUUID)();
    const now = firestore_1.Timestamp.now();
    const decision = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(otpRef);
        if (!snapshot.exists)
            return "missing";
        const saved = snapshot.data();
        if (saved.expiresAt.toMillis() <= now.toMillis())
            return "expired";
        if (Number(saved.attempts) >= 5)
            return "locked";
        if (!matchesOtp(email, otp, String(saved.otpHash))) {
            transaction.update(otpRef, { attempts: Number(saved.attempts) + 1 });
            return "incorrect";
        }
        if (saved.claimed)
            return "claimed";
        transaction.update(otpRef, { claimed: true, claimId });
        return "valid";
    });
    if (decision === "incorrect")
        throw new https_1.HttpsError("invalid-argument", "That code is not correct.");
    if (decision === "locked")
        throw new https_1.HttpsError("resource-exhausted", "Too many incorrect codes. Request a new one.");
    if (decision === "expired" || decision === "missing")
        throw new https_1.HttpsError("deadline-exceeded", "Request a new verification code.");
    if (decision === "claimed")
        throw new https_1.HttpsError("aborted", "This verification code is already being used.");
    let uid;
    try {
        const created = await (0, auth_1.getAuth)().createUser({
            email,
            password,
            displayName: fullName,
            phoneNumber: phone,
            emailVerified: true,
        });
        uid = created.uid;
        await (0, auth_1.getAuth)().setCustomUserClaims(uid, { role: "driver" });
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
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        });
        const customToken = await (0, auth_1.getAuth)().createCustomToken(uid, { role: "driver" });
        await otpRef.delete();
        return { uid, customToken };
    }
    catch (error) {
        if (uid) {
            await db.collection("drivers").doc(uid).delete().catch((cleanupError) => console.error("Failed to clean up incomplete driver profile", cleanupError));
            await (0, auth_1.getAuth)().deleteUser(uid).catch((cleanupError) => console.error("Failed to clean up incomplete driver account", cleanupError));
        }
        await otpRef.update({ claimed: false, claimId: null }).catch((cleanupError) => console.error("Failed to release OTP claim", cleanupError));
        if (error.code === "auth/email-already-exists" || error.code === "auth/phone-number-already-exists") {
            throw new https_1.HttpsError("already-exists", "An account already uses these details.");
        }
        console.error("Driver account creation failed", error);
        throw new https_1.HttpsError("internal", "Your driver account could not be created. Please try again.");
    }
});
exports.finalizeDriverRegistration = (0, https_1.onCall)({ region }, async (request) => {
    const uid = ensureDriver(request);
    const payload = request.data;
    if (payload.uid !== uid)
        throw new https_1.HttpsError("permission-denied", "You can only finalize your own registration.");
    const paths = payload.paths;
    if (typeof paths !== "object" || paths === null)
        throw new https_1.HttpsError("invalid-argument", "Verification images are required.");
    const requiredImages = ["licenseFront", "licenseBack", "aadhaarFront", "aadhaarBack", "profilePhoto", "vehiclePhoto"];
    const imagePaths = Object.fromEntries(requiredImages.map((name) => {
        const path = paths[name];
        if (path !== `drivers/${uid}/verification/${name}`) {
            throw new https_1.HttpsError("invalid-argument", "A verification image path is invalid.");
        }
        return [name, path];
    }));
    const bucket = (0, storage_1.getStorage)().bucket();
    await Promise.all(Object.values(imagePaths).map(async (path) => {
        const [metadata] = await bucket.file(String(path)).getMetadata().catch(() => {
            throw new https_1.HttpsError("failed-precondition", "All verification images must finish uploading before submission.");
        });
        if (!metadata.contentType?.match(/^image\/(jpeg|png|webp|heic)$/) || Number(metadata.size) > 10 * 1024 * 1024) {
            throw new https_1.HttpsError("failed-precondition", "A verification image has an unsupported format or size.");
        }
    }));
    const aadhaarNumber = requiredString(payload.aadhaarNumber, "Aadhaar number", 12, 12);
    if (!/^\d{12}$/.test(aadhaarNumber))
        throw new https_1.HttpsError("invalid-argument", "Enter a valid 12-digit Aadhaar number.");
    const { ref, data } = await driverRef(uid);
    if (data.registrationComplete)
        throw new https_1.HttpsError("already-exists", "Registration has already been submitted.");
    await ref.collection("private").doc("verification").set({
        licenseNumber: requiredString(payload.licenseNumber, "Licence number", 4, 40).toUpperCase(),
        aadhaarNumber,
        imagePaths,
        vehicleType: requiredString(payload.vehicleType, "Vehicle type", 3, 4),
        vehicleNumber: requiredString(payload.vehicleNumber, "Vehicle registration", 5, 20).toUpperCase(),
        vehicleModel: requiredString(payload.vehicleModel, "Vehicle model", 2, 60),
        vehicleColour: requiredString(payload.vehicleColour, "Vehicle colour", 2, 40),
        submittedAt: firestore_1.Timestamp.now(),
    });
    await ref.update({
        profileImagePath: imagePaths.profilePhoto,
        registrationComplete: true,
        updatedAt: firestore_1.Timestamp.now(),
    });
    return { submitted: true };
});
exports.setDriverAvailability = (0, https_1.onCall)({ region }, async (request) => {
    const uid = ensureDriver(request);
    if (typeof request.data.online !== "boolean")
        throw new https_1.HttpsError("invalid-argument", "Availability must be on or off.");
    const ref = db.collection("drivers").doc(uid);
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const driver = snapshot.data();
        if (!driver?.registrationComplete || driver.profileStatus !== "approved") {
            throw new https_1.HttpsError("failed-precondition", "Driver approval is required before going online.");
        }
        if (request.data.online) {
            if (driver.availabilityStatus === "on_ride")
                throw new https_1.HttpsError("failed-precondition", "Finish the active ride first.");
            transaction.update(ref, { availabilityStatus: "online", updatedAt: firestore_1.Timestamp.now() });
        }
        else {
            if (driver.availabilityStatus === "on_ride") {
                throw new https_1.HttpsError("failed-precondition", "Complete or cancel the active ride before going offline.");
            }
            transaction.update(ref, { availabilityStatus: "offline", updatedAt: firestore_1.Timestamp.now() });
        }
    });
    return { updated: true };
});
exports.acceptRide = (0, https_1.onCall)({ region }, async (request) => {
    const uid = ensureDriver(request);
    const rideId = requiredString(request.data.rideId, "Ride", 1, 128);
    const driver = db.collection("drivers").doc(uid);
    const ride = db.collection("rides").doc(rideId);
    await db.runTransaction(async (transaction) => {
        const [driverSnapshot, rideSnapshot] = await Promise.all([transaction.get(driver), transaction.get(ride)]);
        const driverData = driverSnapshot.data();
        const rideData = rideSnapshot.data();
        if (!driverData?.registrationComplete || driverData.profileStatus !== "approved" || driverData.availabilityStatus !== "online") {
            throw new https_1.HttpsError("failed-precondition", "You must be approved and online to accept rides.");
        }
        if (!rideSnapshot.exists || rideData?.status !== "requested") {
            throw new https_1.HttpsError("aborted", "This ride is no longer available.");
        }
        transaction.update(ride, {
            driverUid: uid,
            status: "accepted",
            acceptedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        });
        transaction.update(driver, { availabilityStatus: "on_ride", updatedAt: firestore_1.Timestamp.now() });
    });
    return { accepted: true };
});
exports.updateRideStatus = (0, https_1.onCall)({ region }, async (request) => {
    const uid = ensureDriver(request);
    const rideId = requiredString(request.data.rideId, "Ride", 1, 128);
    const nextStatus = requiredString(request.data.status, "Ride status", 3, 20);
    const rideRef = db.collection("rides").doc(rideId);
    const driverRef = db.collection("drivers").doc(uid);
    await db.runTransaction(async (transaction) => {
        const [rideSnapshot, driverSnapshot] = await Promise.all([transaction.get(rideRef), transaction.get(driverRef)]);
        const ride = rideSnapshot.data();
        if (!rideSnapshot.exists || ride?.driverUid !== uid)
            throw new https_1.HttpsError("not-found", "Ride not found.");
        const allowed = {
            accepted: ["driver_arriving", "cancelled"],
            driver_arriving: ["in_progress", "cancelled"],
            in_progress: ["completed"],
        };
        if (!allowed[String(ride.status)]?.includes(nextStatus)) {
            throw new https_1.HttpsError("failed-precondition", "This ride status change is not allowed.");
        }
        transaction.update(rideRef, { status: nextStatus, updatedAt: firestore_1.Timestamp.now() });
        if (nextStatus === "completed" || nextStatus === "cancelled") {
            transaction.update(driverRef, {
                availabilityStatus: "online",
                completedRides: nextStatus === "completed" ? Number(driverSnapshot.data()?.completedRides ?? 0) + 1 : Number(driverSnapshot.data()?.completedRides ?? 0),
                updatedAt: firestore_1.Timestamp.now(),
            });
        }
    });
    return { updated: true };
});
exports.updateDriverLocation = (0, https_1.onCall)({ region }, async (request) => {
    const uid = ensureDriver(request);
    const latitude = Number(request.data.latitude);
    const longitude = Number(request.data.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new https_1.HttpsError("invalid-argument", "Location coordinates are invalid.");
    }
    const ref = db.collection("driverLocations").doc(uid);
    const now = firestore_1.Timestamp.now();
    await db.runTransaction(async (transaction) => {
        const previous = (await transaction.get(ref)).data();
        const lastUpdate = previous?.updatedAt;
        if (lastUpdate && now.toMillis() - lastUpdate.toMillis() < 15_000)
            return;
        transaction.set(ref, { latitude, longitude, updatedAt: now });
    });
    return { updated: true };
});
exports.registerDriverPushToken = (0, https_1.onCall)({ region }, async (request) => {
    const uid = ensureDriver(request);
    const token = requiredString(request.data.token, "Push token", 20, 4096);
    await db.collection("drivers").doc(uid).collection("private").doc("pushTokens").set({
        tokens: { [(0, node_crypto_1.createHash)("sha256").update(token).digest("hex")]: token },
        updatedAt: firestore_1.Timestamp.now(),
    }, { merge: true });
    return { registered: true };
});
exports.notifyDriversOfRide = (0, firestore_2.onDocumentCreated)({ document: "rides/{rideId}", region }, async (event) => {
    const ride = event.data?.data();
    if (!ride || ride.status !== "requested")
        return;
    const onlineDrivers = await db.collection("drivers")
        .where("profileStatus", "==", "approved")
        .where("availabilityStatus", "==", "online")
        .where("registrationComplete", "==", true)
        .limit(500)
        .get();
    const tokens = [];
    for (const driver of onlineDrivers.docs) {
        const saved = await driver.ref.collection("private").doc("pushTokens").get();
        const record = saved.data()?.tokens;
        if (record && typeof record === "object")
            tokens.push(...Object.values(record).filter((value) => typeof value === "string"));
    }
    if (!tokens.length)
        return;
    const result = await (0, messaging_1.getMessaging)().sendEachForMulticast({
        tokens: [...new Set(tokens)].slice(0, 500),
        notification: { title: "New ride request", body: String(ride.pickup ?? "A nearby pickup") },
        data: { rideId: event.params.rideId },
        android: { priority: "high", notification: { channelId: "driver-rides" } },
    });
    if (result.failureCount)
        console.warn("Some driver ride notifications could not be delivered", result.failureCount);
});
