import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "@firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
import * as SecureStore from "expo-secure-store";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missing.length) {
  throw new Error(`Missing Firebase configuration: ${missing.join(", ")}. See mobile/.env.example.`);
}

const app = getApps()[0] ?? initializeApp(firebaseConfig);
const securePersistence = getReactNativePersistence({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
});

export const auth = (() => {
  try {
    return initializeAuth(app, { persistence: securePersistence });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already been initialized")) {
      return getAuth(app);
    }
    throw error;
  }
})();
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION || "asia-south1");
