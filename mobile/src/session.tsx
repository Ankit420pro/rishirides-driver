import axios from "axios";
import { createContext, PropsWithChildren, useContext, useEffect, useState } from "react";
import { Driver, driverApi, tokenStore } from "./api";

type Session = {
  driver: Driver | null;
  loading: boolean;
  error: string;
  login: (phone: string, password: string) => Promise<void>;
  signup: (payload: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
  refreshDriver: () => Promise<Driver>;
};

const SessionContext = createContext<Session | null>(null);

function messageFrom(error: unknown) {
  if (axios.isAxiosError(error)) return error.response?.data?.detail ?? "Could not reach RishiRide. Check the network and try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    tokenStore.get().then(async (token) => {
      if (token) {
        try { const response = await driverApi.me(); if (alive) setDriver(response.data); }
        catch { await tokenStore.clear(); }
      }
      if (alive) setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function login(phone: string, password: string) {
    setError("");
    try { await driverApi.login(phone, password); setDriver((await driverApi.me()).data); }
    catch (cause) { await tokenStore.clear(); setError(messageFrom(cause)); throw cause; }
  }

  async function signup(payload: Record<string, string>) {
    setError("");
    try { await driverApi.signup(payload); }
    catch (cause) { setError(messageFrom(cause)); throw cause; }
  }

  async function logout() {
    await driverApi.logout();
    setDriver(null);
  }

  async function refreshDriver() {
    const updated = (await driverApi.me()).data;
    setDriver(updated);
    return updated;
  }

  return <SessionContext.Provider value={{ driver, loading, error, login, signup, logout, refreshDriver }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}