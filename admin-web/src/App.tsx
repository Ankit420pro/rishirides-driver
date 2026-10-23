import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, CarFront, Check, CircleAlert, Clock3, LogOut, MapPinned, Search, ShieldAlert, Users, X } from "lucide-react";
import axios from "axios";
import { adminApi, Driver, DriverDetail, DriverPage, Stats } from "./api";

function errorText(error: unknown) {
  if (axios.isAxiosError(error)) return error.response?.data?.detail ?? "The server could not be reached. Check the API URL and network.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try { await adminApi.login(email, password); onLogin(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <main className="login-shell"><div className="login-art"><div className="brand"><span className="brand-icon">R</span><span>RishiRide <small>OPERATIONS</small></span></div><div className="login-art-copy"><div className="eyebrow">FLEET CONTROL / 01</div><h1>Every ride<br />starts with<br /><em>the right driver.</em></h1><div className="art-rule" /><p>Driver verification and fleet operations.</p></div><div className="art-foot">RISHIRIDE · DRIVER NETWORK</div></div><section className="login-form-side"><form className="login-form" onSubmit={submit}><div className="eyebrow">ADMIN ACCESS</div><h2>Sign in</h2><p>Use your RishiRide administrator account.</p><label>Email address<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ops@rishiride.com" /></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /></label>{error && <div className="alert error-alert"><CircleAlert size={16} />{error}</div>}<button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in to operations"}<ArrowRight size={16} /></button><div className="login-foot">Admin accounts are provisioned through the secure backend command.</div></form></section></main>;
}

function statusClass(value: string) { return `pill ${value.replaceAll("_", "-")}`; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }

export default function App() {
  const [authenticated, setAuthenticated] = useState(adminApi.hasToken());
  const [page, setPage] = useState<DriverPage | null>(null); const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<DriverDetail | null>(null); const [query, setQuery] = useState("");
  const [approval, setApproval] = useState(""); const [availability, setAvailability] = useState(""); const [vehicle, setVehicle] = useState(""); const [pageNumber, setPageNumber] = useState(1);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [toast, setToast] = useState("");

  async function load() {
    setBusy(true); setError("");
    try {
      const [drivers, summary] = await Promise.all([adminApi.drivers({ page: pageNumber, page_size: 10, search: query, profile_status: approval, availability_status: availability, vehicle_type: vehicle }), adminApi.stats()]);
      setPage(drivers.data); setStats(summary.data);
    } catch (cause) { setError(errorText(cause)); if (axios.isAxiosError(cause) && cause.response?.status === 401) { setAuthenticated(false); } }
    finally { setBusy(false); }
  }

  useEffect(() => { if (authenticated) void load(); }, [authenticated, pageNumber, query, approval, availability, vehicle]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 3200); return () => clearTimeout(timer); } }, [toast]);

  async function openDetail(driver: Driver) {
    setError("");
    try { setSelected((await adminApi.detail(driver.id)).data); }
    catch (cause) { setError(errorText(cause)); }
  }

  async function decide(driver: Driver, decision: "approved" | "rejected") {
    const verb = decision === "approved" ? "approve" : "reject";
    if (!window.confirm(`${verb === "approve" ? "Approve" : "Reject"} ${driver.full_name}?`)) return;
    try { await adminApi.decide(driver.id, decision); setToast(`Driver ${decision}.`); setSelected(null); await load(); }
    catch (cause) { setError(errorText(cause)); }
  }

  async function suspend(driver: Driver) {
    const next = !driver.is_suspended;
    const reason = window.prompt(next ? "Reason for suspension" : "Reason for reactivation", next ? "Policy review" : "Review completed");
    if (!reason) return;
    try { await adminApi.suspend(driver.id, next, reason); setToast(next ? "Driver suspended." : "Driver reactivated."); if (selected) setSelected((await adminApi.detail(driver.id)).data); await load(); }
    catch (cause) { setError(errorText(cause)); }
  }

  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-icon">R</span><span>RishiRide <small>OPERATIONS</small></span></div><div className="side-label">WORKSPACE</div><button className="nav-item active"><Users size={17} />Drivers <span className="nav-count">{stats?.total_drivers ?? "—"}</span></button><div className="sidebar-bottom"><div className="secure-mark"><ShieldAlert size={16} /><span>Restricted admin access</span></div><button className="nav-item" onClick={() => { void adminApi.logout().finally(() => setAuthenticated(false)); }}><LogOut size={16} />Sign out</button></div></aside>
    <main className="main-area"><header className="topbar"><div><span>Operations</span><span className="crumb">/</span><strong>Drivers</strong></div><div className="topbar-right"><span className="connection-dot" />API connected</div></header>
      <div className="content"><div className="page-heading"><div><div className="eyebrow">FLEET MANAGEMENT</div><h1>Drivers</h1><p>Review applications and manage the active driver network.</p></div><button className="button subtle" onClick={() => void load()} disabled={busy}><Clock3 size={15} />{busy ? "Refreshing" : "Refresh"}</button></div>
        {error && <div className="alert error-alert"><CircleAlert size={16} />{error}<button className="icon-button" onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
        <div className="stat-grid">{[
          { label: "Total drivers", value: stats?.total_drivers, icon: Users, tone: "green" },
          { label: "Pending review", value: stats?.pending_approvals, icon: Clock3, tone: "amber" },
          { label: "Online now", value: stats?.online_drivers, icon: MapPinned, tone: "blue" },
          { label: "On a ride", value: stats?.drivers_on_rides, icon: CarFront, tone: "coral" },
        ].map(({ label, value, icon: Icon, tone }) => <div className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={17} /></div><div><span className="stat-label">{label}</span><strong>{value ?? "—"}</strong></div></div>)}</div>
        <section className="table-panel"><div className="table-toolbar"><div className="search-wrap"><Search size={16} /><input value={query} placeholder="Search name, phone, email, vehicle" onChange={(event) => { setQuery(event.target.value); setPageNumber(1); }} /></div><div className="filters"><select aria-label="Approval status" value={approval} onChange={(event) => { setApproval(event.target.value); setPageNumber(1); }}><option value="">All approvals</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><select aria-label="Availability" value={availability} onChange={(event) => { setAvailability(event.target.value); setPageNumber(1); }}><option value="">All availability</option><option value="online">Online</option><option value="offline">Offline</option><option value="on_ride">On ride</option></select><select aria-label="Vehicle type" value={vehicle} onChange={(event) => { setVehicle(event.target.value); setPageNumber(1); }}><option value="">All vehicles</option><option value="car">Car</option><option value="auto">Auto</option><option value="bike">Bike</option></select></div></div>
          <div className="table-scroll"><table><thead><tr><th>Driver</th><th>Contact</th><th>Vehicle</th><th>Verification</th><th>Availability</th><th>Registered</th><th /></tr></thead><tbody>
            {busy && !page ? <tr><td colSpan={7}><div className="table-loading">Loading drivers…</div></td></tr> : page?.items.map((driver) => <tr key={driver.id} onClick={() => void openDetail(driver)} className="driver-row"><td><div className="driver-cell"><span className="avatar">{initials(driver.full_name)}</span><span><strong>{driver.full_name}</strong><small>{driver.is_suspended ? "Suspended" : driver.is_verified ? "Verified" : "Not verified"}</small></span></div></td><td><div className="contact-cell"><span>{driver.phone}</span><small>{driver.email}</small></div></td><td><span className="vehicle-type">{driver.vehicle_type}</span><small className="vehicle-number">{driver.vehicle_number}</small></td><td><span className={statusClass(driver.profile_status)}><i />{driver.profile_status}</span></td><td><span className={statusClass(driver.availability_status)}><i />{driver.availability_status.replaceAll("_", " ")}</span></td><td>{new Date(driver.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</td><td><button className="row-arrow" aria-label={`Open ${driver.full_name}`}><ArrowRight size={16} /></button></td></tr>)}
            {!busy && page?.items.length === 0 && <tr><td colSpan={7}><div className="empty-state"><Users size={22} /><strong>No drivers match these filters</strong><span>Try another search or clear a filter.</span></div></td></tr>}
          </tbody></table></div>
          <footer className="table-footer"><span>{page ? `${page.total === 0 ? 0 : (page.page - 1) * page.page_size + 1}–${Math.min(page.page * page.page_size, page.total)} of ${page.total} drivers` : "Loading records"}</span><div className="pagination"><button aria-label="Previous page" disabled={!page || page.page <= 1} onClick={() => setPageNumber((value) => value - 1)}><ArrowLeft size={15} /></button><span>Page {page?.page ?? 1} of {page?.pages ?? 1}</span><button aria-label="Next page" disabled={!page || page.page >= page.pages} onClick={() => setPageNumber((value) => value + 1)}><ArrowRight size={15} /></button></div></footer>
        </section>
        <div className="bottom-note"><BadgeCheck size={15} />License details are masked and visible only in an authorized driver record.</div>
      </div>
    </main>
    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="detail-drawer" onClick={(event) => event.stopPropagation()}><header className="drawer-head"><div><div className="eyebrow">DRIVER RECORD</div><strong>Profile details</strong></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close driver details"><X size={18} /></button></header><div className="drawer-profile"><span className="avatar large">{initials(selected.full_name)}</span><div><h2>{selected.full_name}</h2><span className={statusClass(selected.profile_status)}><i />{selected.profile_status}</span></div></div><div className="detail-section"><h3>Contact details</h3><dl><div><dt>Email</dt><dd>{selected.email}</dd></div><div><dt>Phone</dt><dd>{selected.phone}</dd></div><div><dt>Driver ID</dt><dd className="mono">{selected.id}</dd></div></dl></div><div className="detail-section"><h3>Vehicle and verification</h3><dl><div><dt>Vehicle type</dt><dd className="capitalize">{selected.vehicle_type}</dd></div><div><dt>Registration</dt><dd>{selected.vehicle_number}</dd></div><div><dt>License</dt><dd className="mono">{selected.driving_license_number_masked ?? "Restricted"}</dd></div><div><dt>Availability</dt><dd className="capitalize">{selected.availability_status.replaceAll("_", " ")}</dd></div><div><dt>Registered</dt><dd>{new Date(selected.created_at).toLocaleDateString()}</dd></div></dl></div><div className="detail-section"><h3>Ride activity</h3><div className="ride-stats"><div><strong>{selected.ride_statistics.completed}</strong><span>Completed</span></div><div><strong>{selected.ride_statistics.cancelled}</strong><span>Cancelled</span></div></div></div><div className="drawer-actions">{selected.profile_status === "pending" && <><button className="button primary" onClick={() => void decide(selected, "approved")}><Check size={15} />Approve</button><button className="button danger" onClick={() => void decide(selected, "rejected")}><X size={15} />Reject</button></>}{selected.profile_status !== "pending" && <button className={`button ${selected.is_suspended ? "primary" : "danger"}`} onClick={() => void suspend(selected)}><ShieldAlert size={15} />{selected.is_suspended ? "Reactivate driver" : "Suspend driver"}</button>}</div></aside></div>}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>;
}