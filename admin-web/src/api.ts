import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL;
if (!baseURL) throw new Error("Set VITE_API_URL before starting the admin dashboard.");

const api = axios.create({ baseURL, timeout: 15000 });
const TOKEN_KEY = "rishiride.admin.access-token";
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401) sessionStorage.removeItem(TOKEN_KEY);
  return Promise.reject(error);
});

export type Driver = {
  id: string; full_name: string; email: string; phone: string; vehicle_type: string; vehicle_number: string;
  profile_status: "pending" | "approved" | "rejected"; availability_status: "online" | "offline" | "on_ride";
  is_verified: boolean; is_suspended: boolean; created_at: string; profile_image_url?: string | null;
};
export type DriverPage = { items: Driver[]; total: number; page: number; page_size: number; pages: number; counts: Record<string, number> };
export type DriverDetail = Driver & { driving_license_number_masked?: string; ride_statistics: { completed: number; cancelled: number } };
export type Stats = { total_drivers: number; pending_approvals: number; approved_drivers: number; online_drivers: number; drivers_on_rides: number; completed_rides: number };

export const adminApi = {
  async login(email: string, password: string) {
    const { data } = await api.post<{ access_token: string }>("/auth/admin/login", { email, password });
    sessionStorage.setItem(TOKEN_KEY, data.access_token);
  },
  async logout() {
    try { await api.post("/auth/logout"); }
    finally { sessionStorage.removeItem(TOKEN_KEY); }
  },
  hasToken: () => Boolean(sessionStorage.getItem(TOKEN_KEY)),
  drivers: (params: Record<string, string | number>) => api.get<DriverPage>("/admin/drivers", { params }),
  detail: (id: string) => api.get<DriverDetail>(`/admin/drivers/${id}`),
  decide: (id: string, profile_status: "approved" | "rejected") => api.patch(`/admin/drivers/${id}/approval`, { profile_status }),
  suspend: (id: string, suspended: boolean, reason: string) => api.patch(`/admin/drivers/${id}/suspend`, { suspended, reason }),
  stats: () => api.get<Stats>("/admin/stats"),
};