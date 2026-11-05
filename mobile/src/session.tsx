import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "@firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { auth, db, functions } from "./firebase";

export type Driver = {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  vehicleType: "car" | "bike" | "auto";
  vehicleNumber: string;
  vehicleModel: string;
  vehicleColour: string;
  profileStatus: "pending" | "approved" | "rejected";
  availabilityStatus: "online" | "offline" | "on_ride";
  registrationComplete: boolean;
  completedRides: number;
};

export type Ride = {
  id: string;
  pickup: string;
  destination: string;
  fare?: number;
  status: string;
  driverUid?: string;
  passengerName?: string;
};

type RegistrationIdentity = {
  email: string;
  otp: string;
  fullName: string;
  phone: string;
  password: string;
  vehicleType: Driver["vehicleType"];
  vehicleNumber: string;
  vehicleModel: string;
  vehicleColour: string;
  licenseNumber: string;
  aadhaarNumber: string;
};

type Session = {
  driver: Driver | null;
  loading: boolean;
  registrationInProgress: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: {
    requestOtp: (email: string, fullName: string) => Promise<void>;
    verifyOtp: (payload: RegistrationIdentity) => Promise<{ customToken: string; uid: string }>;
    signInWithToken: (token: string) => Promise<void>;
    finalizeRegistration: (payload: Record<string, unknown>) => Promise<void>;
    completeRegistration: () => void;
    resetPassword: (email: string) => Promise<void>;
    setAvailability: (online: boolean) => Promise<void>;
    acceptRide: (rideId: string) => Promise<void>;
    updateRide: (rideId: string, status: string) => Promise<void>;
    updateLocation: (latitude: number, longitude: number) => Promise<void>;
    registerPushToken: (token: string) => Promise<void>;
  };
  refreshDriver: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

function messageFrom(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code.includes("auth/invalid-credential")) return "Incorrect email or password.";
    if (code.includes("auth/too-many-requests")) return "Too many attempts. Please wait and try again.";
    if (code.includes("auth/network-request-failed")) return "Network unavailable. Check your connection and try again.";
    if (code.includes("functions/")) return "The request could not be completed. Please try again.";
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function call<Payload extends object, Result = Record<string, never>>(name: string) {
  return httpsCallable<Payload, Result>(functions, name);
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [registrationInProgress, setRegistrationInProgress] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setDriver(null);
    setLoading(Boolean(nextUser));
  }, () => {
    setError("Your sign-in session could not be restored.");
    setLoading(false);
  }), []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    return onSnapshot(doc(db, "drivers", user.uid), (snapshot) => {
      if (!snapshot.exists()) {
        setDriver(null);
        setError("Your driver profile is not available. Please contact support.");
      } else {
        setDriver({ uid: user.uid, ...snapshot.data() } as Driver);
        setError("");
      }
      setLoading(false);
    }, () => {
      setError("Your driver profile could not be loaded. Check your connection and retry.");
      setLoading(false);
    });
  }, [user]);

  async function login(email: string, password: string) {
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (cause) {
      const message = messageFrom(cause);
      setError(message);
      throw new Error(message);
    }
  }

  async function logout() {
    await signOut(auth);
    setDriver(null);
    setRegistrationInProgress(false);
  }

  const actions = useMemo<Session["register"]>(() => ({
    async requestOtp(email, fullName) {
      await call<{ email: string; fullName: string }>("requestDriverOtp")({ email, fullName });
    },
    async verifyOtp(payload) {
      const result = await call<RegistrationIdentity, { customToken: string; uid: string }>("verifyDriverOtp")(payload);
      return result.data;
    },
    async signInWithToken(token) {
      setRegistrationInProgress(true);
      await signInWithCustomToken(auth, token);
    },
    async finalizeRegistration(payload) {
      await call<Record<string, unknown>>("finalizeDriverRegistration")(payload);
    },
    completeRegistration() {
      setRegistrationInProgress(false);
    },
    async resetPassword(email) {
      await sendPasswordResetEmail(auth, email);
    },
    async setAvailability(online) {
      await call<{ online: boolean }>("setDriverAvailability")({ online });
    },
    async acceptRide(rideId) {
      await call<{ rideId: string }>("acceptRide")({ rideId });
    },
    async updateRide(rideId, status) {
      await call<{ rideId: string; status: string }>("updateRideStatus")({ rideId, status });
    },
    async updateLocation(latitude, longitude) {
      await call<{ latitude: number; longitude: number }>("updateDriverLocation")({ latitude, longitude });
    },
    async registerPushToken(token) {
      await call<{ token: string }>("registerDriverPushToken")({ token });
    },
  }), []);

  async function refreshDriver() {
    if (!user) return;
    const snapshot = await getDoc(doc(db, "drivers", user.uid));
    if (snapshot.exists()) setDriver({ uid: user.uid, ...snapshot.data() } as Driver);
  }

  const value = useMemo<Session>(() => ({
    driver,
    loading,
    registrationInProgress,
    error,
    login,
    logout,
    register: actions,
    refreshDriver,
  }), [actions, driver, error, loading, registrationInProgress, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
