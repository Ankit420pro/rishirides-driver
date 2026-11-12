import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {defineSecret} from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';

admin.initializeApp();
const db = admin.firestore();
const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const OTP_SECRET = defineSecret('OTP_SECRET');
const digest = (value: string) => crypto.createHmac('sha256', OTP_SECRET.value()).update(value).digest('hex');

export const sendEmailOtp = onCall({secrets:[SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, OTP_SECRET], enforceAppCheck:true}, async (request) => {
  const email = String(request.data?.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  const now = Date.now();
  const ref = db.collection('emailOtps').doc(crypto.createHash('sha256').update(email).digest('hex'));
  const existing = await ref.get();
  if (existing.exists && now - Number(existing.get('sentAt') ?? 0) < 60_000) throw new HttpsError('resource-exhausted', 'Please wait one minute before requesting another OTP.');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await ref.set({hash:digest(`${email}:${code}`), sentAt:now, expiresAt:now + 10*60_000, attempts:0, verified:false});
  const port = Number(SMTP_PORT.value());
  const transporter = nodemailer.createTransport({host:SMTP_HOST.value(), port, secure:port === 465, auth:{user:SMTP_USER.value(), pass:SMTP_PASS.value()}});
  await transporter.sendMail({from:SMTP_USER.value(), to:email, subject:'Your Rishiides Driver verification code', text:`Your Rishiides verification code is ${code}. It expires in 10 minutes. Do not share it.`});
  return {sent:true};
});

export const verifyEmailOtp = onCall({secrets:[OTP_SECRET], enforceAppCheck:true}, async (request) => {
  const email = String(request.data?.email ?? '').trim().toLowerCase();
  const code = String(request.data?.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'Enter the six-digit code.');
  const ref = db.collection('emailOtps').doc(crypto.createHash('sha256').update(email).digest('hex'));
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data()!;
    if (data.verified || Date.now() > data.expiresAt || data.attempts >= 5) return false;
    const valid = digest(`${email}:${code}`) === data.hash;
    tx.update(ref, valid ? {verified:true, verifiedAt:Date.now(), hash:admin.firestore.FieldValue.delete()} : {attempts:admin.firestore.FieldValue.increment(1)});
    return valid;
  });
  if (!result) throw new HttpsError('permission-denied', 'The code is invalid or expired.');
  return {verified:true};
});
