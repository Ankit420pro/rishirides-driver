import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Driver, driverApi, Ride } from "../src/api";
import { useSession } from "../src/session";

const ink = "#182624";
const green = "#16765d";

function AuthScreen() {
  const { login, signup, error } = useSession();
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({ full_name: "", email: "", phone: "", password: "", vehicle_type: "car", vehicle_number: "", driving_license_number: "" });
  const field = (key: keyof typeof fields, placeholder: string, secureTextEntry = false, keyboardType: "default" | "email-address" | "phone-pad" = "default") => (
    <TextInput key={key} style={styles.input} placeholder={placeholder} placeholderTextColor="#71807b" value={fields[key]} secureTextEntry={secureTextEntry} keyboardType={keyboardType} autoCapitalize={key === "email" ? "none" : "sentences"} onChangeText={(value) => setFields((current) => ({ ...current, [key]: value }))} />
  );
  async function submit() {
    setBusy(true);
    try {
      if (registering) {
        await signup(fields);
        setRegistering(false);
        Alert.alert("Application received", "Your driver profile is pending approval. Sign in to check your status.");
      } else await login(fields.email || fields.phone, fields.password);
    } catch { /* Session state exposes the API error. */ }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.authPage}>
    <View style={styles.brandMark}><Text style={styles.markText}>R</Text></View>
    <Text style={styles.eyebrow}>RISHIRIDE / DRIVER</Text>
    <Text style={styles.authTitle}>{registering ? "Start driving." : "Good to see you."}</Text>
    <Text style={styles.authSubtitle}>{registering ? "Create your driver profile to begin verification." : "Sign in to get back on the road."}</Text>
    <View style={styles.form}>
      {registering && <>{field("full_name", "Full name")}{field("email", "Email address", false, "email-address")}{field("phone", "Phone, e.g. +14155552671", false, "phone-pad")}</>}
      {!registering && <>{field("email", "Email or phone")}</>}
      {field("password", "Password", true)}
      {registering && <><View style={styles.vehicleChoices}>{(["auto", "bike", "car"] as const).map((vehicle) => <Pressable key={vehicle} onPress={() => setFields((current) => ({ ...current, vehicle_type: vehicle }))} style={[styles.vehicleChoice, fields.vehicle_type === vehicle && styles.vehicleChoiceSelected]}><Text style={[styles.vehicleChoiceText, fields.vehicle_type === vehicle && styles.vehicleChoiceTextSelected]}>{vehicle.toUpperCase()}</Text></Pressable>)}</View>{field("vehicle_number", "Vehicle registration")}{field("driving_license_number", "Driving license number")}</>}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.primaryButton, busy && styles.disabled]} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>{registering ? "Submit application" : "Sign in"}</Text>}
      </Pressable>
      <Pressable style={styles.linkButton} onPress={() => setRegistering((value) => !value)}><Text style={styles.linkText}>{registering ? "Already registered? Sign in" : "New to RishiRide? Apply to drive"}</Text></Pressable>
    </View>
  </SafeAreaView>;
}

function ApprovalNotice({ status }: { status: Driver["profile_status"] }) {
  const copy = status === "pending" ? "Your profile is under review. You can go online once approved." : "Your application was not approved. Contact RishiRide support for next steps.";
  return <View style={[styles.notice, status === "rejected" && styles.noticeBad]}><Text style={styles.noticeTitle}>{status === "pending" ? "Verification in progress" : "Application not approved"}</Text><Text style={styles.noticeCopy}>{copy}</Text></View>;
}

function RideRow({ ride, onAccept, busy }: { ride: Ride; onAccept?: () => void; busy?: boolean }) {
  return <View style={styles.rideRow}>
    <View style={styles.routeLine}><View style={styles.pickupDot} /><View style={styles.routeStem} /><View style={styles.destinationDot} /></View>
    <View style={styles.routeDetails}><Text style={styles.routeLabel}>PICKUP</Text><Text style={styles.routeText}>{ride.pickup_location}</Text><Text style={[styles.routeLabel, styles.destinationLabel]}>DROP-OFF</Text><Text style={styles.routeText}>{ride.destination}</Text></View>
    <View style={styles.fareBlock}><Text style={styles.fare}>{ride.fare_estimate == null ? "—" : `₹${ride.fare_estimate.toFixed(0)}`}</Text><Text style={styles.fareLabel}>EST. FARE</Text></View>
    {onAccept && <Pressable style={styles.acceptButton} disabled={busy} onPress={onAccept}><Text style={styles.acceptText}>{busy ? "Claiming..." : "Accept ride"}</Text></Pressable>}
  </View>;
}

function Dashboard({ driver }: { driver: Driver }) {
  const { logout, refreshDriver } = useSession();
  const [available, setAvailable] = useState<Ride[]>([]);
  const [active, setActive] = useState<Ride[]>([]);
  const [history, setHistory] = useState<Ride[]>([]);
  const [completed, setCompleted] = useState(0);
  const [busyRide, setBusyRide] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const approved = driver.profile_status === "approved";

  async function load() {
    try {
      const currentDriver = await refreshDriver();
      const [activeResult, historyResult, statsResult] = await Promise.all([driverApi.activeRides(), driverApi.rideHistory(), driverApi.stats()]);
      setActive(activeResult.data); setHistory(historyResult.data); setCompleted(statsResult.data.completed_rides);
      if (currentDriver.profile_status === "approved" && currentDriver.availability_status === "online") setAvailable((await driverApi.availableRides()).data);
      else setAvailable([]);
      setMessage("");
    } catch (cause) {
      setMessage("Live data could not be refreshed. Pull down to retry.");
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, 12000);
    return () => clearInterval(interval);
  }, [driver.availability_status, driver.profile_status]);

  async function toggleAvailability(online: boolean) {
    try { await driverApi.availability(online ? "online" : "offline"); await load(); }
    catch (cause) { Alert.alert("Could not change availability", "Only approved drivers can go online. Finish any active ride before going offline."); }
  }

  async function accept(ride: Ride) {
    setBusyRide(ride.id);
    try { await driverApi.acceptRide(ride.id); await load(); }
    catch { Alert.alert("Ride unavailable", "Another driver may have accepted this ride. Requests have been refreshed."); await load(); }
    finally { setBusyRide(""); }
  }

  async function setRideStatus(ride: Ride, next: Ride["ride_status"]) {
    try { await driverApi.updateRide(ride.id, next); await load(); }
    catch { Alert.alert("Status not updated", "Refresh the ride and try again."); }
  }

  const current = active[0];
  return <SafeAreaView style={styles.page}>
    <FlatList
      data={available}
      keyExtractor={(ride) => ride.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={green} />}
      ListHeaderComponent={<>
        <View style={styles.topBar}><View><Text style={styles.eyebrow}>RISHIRIDE / DRIVER</Text><Text style={styles.welcome}>Hello, {driver.full_name.split(" ")[0]}</Text></View><Pressable style={styles.logoutButton} onPress={() => void logout()}><Text style={styles.logoutText}>Log out</Text></Pressable></View>
        <View style={styles.profileStrip}>
          {driver.profile_image_url ? <Image source={{ uri: driver.profile_image_url }} style={styles.avatar} /> : <View style={styles.avatarFallback}><Text style={styles.avatarInitial}>{driver.full_name.charAt(0).toUpperCase()}</Text></View>}
          <View style={styles.profileInfo}><Text style={styles.profileName}>{driver.full_name}</Text><Text style={styles.vehicle}>{driver.vehicle_type.toUpperCase()} · {driver.vehicle_number}</Text></View>
          <View style={[styles.statusTag, { backgroundColor: approved ? "#e3f4ed" : driver.profile_status === "pending" ? "#fff1d7" : "#fde8e5" }]}><Text style={[styles.statusTagText, { color: approved ? green : driver.profile_status === "pending" ? "#9b6417" : "#b14135" }]}>{driver.profile_status}</Text></View>
        </View>
        {approved ? <View style={styles.availabilityBar}><View><Text style={styles.availTitle}>{driver.availability_status === "online" ? "You're online" : driver.availability_status === "on_ride" ? "On a ride" : "You're offline"}</Text><Text style={styles.availHint}>{driver.availability_status === "online" ? "Ride requests are coming in" : "Switch on when you're ready"}</Text></View><Switch value={driver.availability_status !== "offline"} disabled={driver.availability_status === "on_ride"} onValueChange={toggleAvailability} trackColor={{ false: "#ccd5d0", true: green }} thumbColor="white" /></View> : <ApprovalNotice status={driver.profile_status} />}
        <View style={styles.statsRow}><View style={styles.stat}><Text style={styles.statNumber}>{completed}</Text><Text style={styles.statLabel}>COMPLETED</Text></View><View style={styles.statDivider} /><View style={styles.stat}><Text style={styles.statNumber}>{history.length}</Text><Text style={styles.statLabel}>RECENT TRIPS</Text></View><View style={styles.statDivider} /><View style={styles.stat}><Text style={styles.statNumber}>{active.length}</Text><Text style={styles.statLabel}>ACTIVE</Text></View></View>
        {current ? <View style={styles.section}><Text style={styles.sectionTitle}>Current ride</Text><RideRow ride={current} busy={false} onAccept={() => undefined} /><View style={styles.statusActions}>{current.ride_status === "accepted" && <Pressable style={styles.primaryButton} onPress={() => void setRideStatus(current, "driver_arriving")}><Text style={styles.primaryText}>I'm on my way</Text></Pressable>}{current.ride_status === "driver_arriving" && <Pressable style={styles.primaryButton} onPress={() => void setRideStatus(current, "in_progress")}><Text style={styles.primaryText}>Start ride</Text></Pressable>}{current.ride_status === "in_progress" && <Pressable style={styles.primaryButton} onPress={() => void setRideStatus(current, "completed")}><Text style={styles.primaryText}>Complete ride</Text></Pressable>}{["accepted", "driver_arriving"].includes(current.ride_status) && <Pressable style={styles.cancelButton} onPress={() => void setRideStatus(current, "cancelled")}><Text style={styles.cancelText}>Cancel ride</Text></Pressable>}</View></View> : null}
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Ride requests</Text><Text style={styles.liveLabel}>POLLING · 12 SEC</Text></View>
        {message ? <Text style={styles.error}>{message}</Text> : null}
        {loading ? <ActivityIndicator style={{ margin: 28 }} color={green} /> : null}
        {!loading && available.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>{driver.availability_status === "online" ? "No requests right now" : "Go online to see requests"}</Text><Text style={styles.emptyCopy}>New trip requests will appear here.</Text></View> : null}
      </>}
      renderItem={({ item }) => <RideRow ride={item} busy={busyRide === item.id} onAccept={() => void accept(item)} />}
      ListFooterComponent={<View style={styles.section}><Text style={styles.sectionTitle}>Recent trips</Text>{history.slice(0, 6).map((ride) => <View key={ride.id} style={styles.historyRow}><View><Text style={styles.historyRoute}>{ride.pickup_location} to {ride.destination}</Text><Text style={styles.historyStatus}>{ride.ride_status} · {ride.fare_estimate == null ? "Fare unavailable" : `₹${ride.fare_estimate.toFixed(0)}`}</Text></View><Text style={styles.historyCheck}>{ride.ride_status === "completed" ? "DONE" : "CANCELLED"}</Text></View>)}{history.length === 0 && <Text style={styles.emptyCopy}>Completed trips will show here.</Text>}</View>}
    />
  </SafeAreaView>;
}

export default function Index() {
  const { driver, loading } = useSession();
  if (loading) return <View style={styles.loader}><ActivityIndicator color={green} size="large" /></View>;
  return driver ? <Dashboard driver={driver} /> : <AuthScreen />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f5f7f3" }, loader: { flex: 1, justifyContent: "center", backgroundColor: "#f5f7f3" },
  authPage: { flex: 1, backgroundColor: "#f5f7f3", padding: 26, justifyContent: "center" }, brandMark: { width: 48, height: 48, backgroundColor: green, justifyContent: "center", alignItems: "center", borderRadius: 14, marginBottom: 25 }, markText: { color: "white", fontSize: 25, fontWeight: "800" }, eyebrow: { color: green, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, authTitle: { color: ink, fontSize: 34, fontWeight: "800", marginTop: 12 }, authSubtitle: { color: "#64716d", fontSize: 15, marginTop: 8, lineHeight: 22 }, form: { marginTop: 28, gap: 12 }, input: { backgroundColor: "white", borderColor: "#dbe2dd", borderWidth: 1, borderRadius: 10, paddingHorizontal: 15, paddingVertical: 14, color: ink, fontSize: 15 }, vehicleChoices: { flexDirection: "row", gap: 8 }, vehicleChoice: { flex: 1, paddingVertical: 12, borderRadius: 9, borderWidth: 1, borderColor: "#dbe2dd", backgroundColor: "white", alignItems: "center" }, vehicleChoiceSelected: { borderColor: green, backgroundColor: "#eaf3ee" }, vehicleChoiceText: { color: "#65736d", fontSize: 12, fontWeight: "700" }, vehicleChoiceTextSelected: { color: green }, primaryButton: { backgroundColor: green, borderRadius: 10, paddingVertical: 15, alignItems: "center", justifyContent: "center", minHeight: 50 }, primaryText: { color: "white", fontWeight: "700", fontSize: 15 }, disabled: { opacity: 0.6 }, linkButton: { alignItems: "center", padding: 12 }, linkText: { color: green, fontWeight: "700", fontSize: 14 }, error: { color: "#ae3d32", fontSize: 13, marginTop: 8 },
  topBar: { padding: 20, paddingTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, welcome: { fontSize: 25, fontWeight: "800", color: ink, marginTop: 5 }, logoutButton: { paddingVertical: 8, paddingHorizontal: 12, borderColor: "#d8e0db", borderWidth: 1, borderRadius: 8 }, logoutText: { color: ink, fontWeight: "700", fontSize: 13 }, profileStrip: { backgroundColor: "white", marginHorizontal: 16, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }, avatar: { width: 46, height: 46, borderRadius: 23 }, avatarFallback: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#dceee7", alignItems: "center", justifyContent: "center" }, avatarInitial: { color: green, fontWeight: "800", fontSize: 19 }, profileInfo: { flex: 1 }, profileName: { color: ink, fontSize: 15, fontWeight: "700" }, vehicle: { color: "#71807b", fontSize: 12, marginTop: 3 }, statusTag: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 5 }, statusTagText: { textTransform: "capitalize", fontSize: 11, fontWeight: "800" }, availabilityBar: { marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 12, backgroundColor: "#eaf3ee", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, availTitle: { color: ink, fontWeight: "800", fontSize: 15 }, availHint: { color: "#64716d", fontSize: 12, marginTop: 4 }, notice: { marginHorizontal: 16, marginTop: 12, borderRadius: 10, backgroundColor: "#fff1d7", padding: 15 }, noticeBad: { backgroundColor: "#fde8e5" }, noticeTitle: { color: ink, fontSize: 14, fontWeight: "800" }, noticeCopy: { color: "#65716d", marginTop: 5, fontSize: 13, lineHeight: 18 }, statsRow: { margin: 16, backgroundColor: "white", borderRadius: 12, paddingVertical: 17, flexDirection: "row", justifyContent: "space-around", alignItems: "center" }, stat: { alignItems: "center", gap: 3 }, statNumber: { color: ink, fontWeight: "800", fontSize: 21 }, statLabel: { color: "#71807b", fontSize: 9, fontWeight: "800", letterSpacing: 0.6 }, statDivider: { width: 1, height: 34, backgroundColor: "#e6ebe7" },
  section: { marginHorizontal: 16, marginBottom: 16, backgroundColor: "white", borderRadius: 12, padding: 16 }, sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 20, marginBottom: 9 }, sectionTitle: { color: ink, fontWeight: "800", fontSize: 17 }, liveLabel: { color: green, fontWeight: "800", fontSize: 9, letterSpacing: 0.7 }, rideRow: { backgroundColor: "white", marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 15, flexDirection: "row", flexWrap: "wrap", alignItems: "center" }, routeLine: { width: 17, alignItems: "center", marginRight: 10, height: 59, justifyContent: "space-between", paddingVertical: 4 }, pickupDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: green }, routeStem: { width: 1, flex: 1, backgroundColor: "#b9c9c1" }, destinationDot: { width: 8, height: 8, backgroundColor: "#df754b" }, routeDetails: { flex: 1 }, routeLabel: { color: "#82908a", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 }, destinationLabel: { marginTop: 10 }, routeText: { color: ink, fontSize: 13, fontWeight: "700", marginTop: 3 }, fareBlock: { alignItems: "flex-end", alignSelf: "flex-start" }, fare: { color: ink, fontSize: 18, fontWeight: "800" }, fareLabel: { color: "#82908a", fontSize: 8, fontWeight: "800", marginTop: 3 }, acceptButton: { width: "100%", marginTop: 14, borderRadius: 8, backgroundColor: "#e9f4ef", padding: 12, alignItems: "center" }, acceptText: { color: green, fontWeight: "800", fontSize: 13 }, statusActions: { gap: 8, marginTop: 12 }, cancelButton: { alignItems: "center", padding: 10 }, cancelText: { color: "#ad4639", fontWeight: "700" }, empty: { marginHorizontal: 16, padding: 22, backgroundColor: "white", borderRadius: 12, alignItems: "center" }, emptyTitle: { color: ink, fontWeight: "800", fontSize: 14 }, emptyCopy: { color: "#71807b", fontSize: 12, marginTop: 6 }, historyRow: { paddingVertical: 13, borderBottomColor: "#edf0ed", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, historyRoute: { color: ink, fontSize: 13, fontWeight: "700" }, historyStatus: { color: "#71807b", fontSize: 11, marginTop: 4, textTransform: "capitalize" }, historyCheck: { color: green, fontSize: 9, fontWeight: "800" },
});