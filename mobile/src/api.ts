import axios from "axios";
import * as SecureStore from "expo-secure-store";

const baseURL = process.env.EXPO_PUBLIC_API_URL;
if (!baseURL) throw new Error("Set EXPO_PUBLIC_API_URL before starting the driver app.");

export const api = axios.create({ baseURL, timeout: 15000 });
const TOKEN_KEY = "rishiride.driver.access-token";

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type Driver = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  profile_image_url?: string | null;
  profile_status: "pending" | "approved" | "rejected";
  availability_status: "online" | "offline" | "on_ride";
  is_verified: boolean;
  vehicle_type: "auto" | "bike" | "car";
  vehicle_number: string;
};

export type Ride = {
  id: string;
  pickup_location: string;
  destination: string;
  fare_estimate?: number | null;
  ride_status: "requested" | "accepted" | "driver_arriving" | "in_progress" | "completed" | "cancelled";
};

export const tokenStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};

export const driverApi = {
  async login(identifier: string, password: string) {
    const { data } = await api.post<{ access_token: string }>("/auth/driver/login", { identifier, password });
    await tokenStore.set(data.access_token);
    return data;
  },
  signup: (payload: Record<string, string>) => api.post("/auth/driver/signup", payload),
  me: () => api.get<Driver>("/drivers/me"),
  availability: (availability_status: "online" | "offline") => api.patch<Driver>("/drivers/me/availability", { availability_status }),
  availableRides: () => api.get<Ride[]>("/rides/available"),
  activeRides: () => api.get<Ride[]>("/drivers/me/rides"),
  rideHistory: () => api.get<Ride[]>("/drivers/me/rides/history"),
  stats: () => api.get<{ completed_rides: number; cancelled_rides: number }>("/drivers/me/stats"),
  acceptRide: (rideId: string) => api.post<Ride>(`/rides/${rideId}/accept`),
  updateRide: (rideId: string, ride_status: Ride["ride_status"]) => api.patch<Ride>(`/rides/${rideId}/status`, { ride_status }),
  async logout() {
    try { await api.post("/auth/logout"); } finally { await tokenStore.clear(); }
  },
};