import { zodResolver } from "@hookform/resolvers/zod";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { Control } from "react-hook-form";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import {
  collection,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, functions, storage } from "../src/firebase";
import { Ride, useSession } from "../src/session";

const navy = "#101E3B";
const navySoft = "#1B2C4E";
const yellow = "#F5BE35";
const canvas = "#F4F6FA";
const muted = "#778198";
const border = "#E5E9F0";
const white = "#FFFFFF";

type Photo = ImagePicker.ImagePickerAsset | null;
const registrationSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name"),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number"),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(12, "Use at least 12 characters"),
  confirmPassword: z.string().min(1, "Confirm your password"),
  licenseNumber: z.string().trim().min(4, "Enter your licence number"),
  licenseFront: z.custom<Photo>((value) => value !== null, "Add the licence front image"),
  licenseBack: z.custom<Photo>((value) => value !== null, "Add the licence back image"),
  aadhaarNumber: z.string().regex(/^\d{12}$/, "Enter a 12-digit Aadhaar number"),
  aadhaarFront: z.custom<Photo>((value) => value !== null, "Add the Aadhaar front image"),
  aadhaarBack: z.custom<Photo>((value) => value !== null, "Add the Aadhaar back image"),
  profilePhoto: z.custom<Photo>((value) => value !== null, "Add a profile photograph"),
  vehicleType: z.enum(["car", "bike", "auto"]),
  vehicleNumber: z.string().trim().min(5, "Enter your vehicle registration number"),
  vehicleModel: z.string().trim().min(2, "Enter your vehicle model"),
  vehicleColour: z.string().trim().min(2, "Enter your vehicle colour"),
  vehiclePhoto: z.custom<Photo>((value) => value !== null, "Add a vehicle photograph"),
  otp: z.string().regex(/^\d{6}$/, "Enter the six-digit code"),
}).refine((value) => value.password === value.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type Registration = z.infer<typeof registrationSchema>;

const defaults: Registration = {
  fullName: "",
  phone: "+91",
  email: "",
  password: "",
  confirmPassword: "",
  licenseNumber: "",
  licenseFront: null,
  licenseBack: null,
  aadhaarNumber: "",
  aadhaarFront: null,
  aadhaarBack: null,
  profilePhoto: null,
  vehicleType: "car",
  vehicleNumber: "",
  vehicleModel: "",
  vehicleColour: "",
  vehiclePhoto: null,
  otp: "",
};

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <View style={[styles.brandMark, large && styles.brandMarkLarge]}>
      <MaterialCommunityIcons name="steering" size={large ? 34 : 24} color={navy} />
      <View style={styles.brandDot} />
    </View>
  );
}

function Field({
  label,
  control,
  name,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
}: {
  label: string;
  control: Control<Registration>;
  name: keyof Registration;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "words" | "characters";
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={[styles.input, error && styles.inputError]}
            value={typeof value === "string" ? value : ""}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
            placeholderTextColor="#A0A8B6"
            secureTextEntry={secureTextEntry}
            keyboardType={keyboardType ?? "default"}
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
          />
          {error?.message ? <Text style={styles.fieldError}>{error.message}</Text> : null}
        </View>
      )}
    />
  );
}

function PhotoPicker({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: Photo;
  onChange: (photo: Photo) => void;
  error?: string;
}) {
  async function choose() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo access to upload your verification images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) onChange(result.assets[0]);
  }

  return (
    <View style={styles.photoField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable onPress={choose} style={[styles.photoButton, error && styles.inputError]}>
        {value ? (
          <Image source={{ uri: value.uri }} style={styles.photoPreview} />
        ) : (
          <MaterialCommunityIcons name="camera-plus-outline" size={23} color={navy} />
        )}
        <Text style={styles.photoButtonText}>{value ? "Change photo" : "Upload photo"}</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={muted} />
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function LandingScreen() {
  const router = useRouter();
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [entrance]);
  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[styles.landing, {
        opacity: entrance,
        transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }]}>
        <View style={styles.landingBrand}>
          <BrandMark large />
          <Text style={styles.brandName}>RISHIIDES</Text>
          <Text style={styles.brandSub}>DRIVER PARTNER</Text>
          <Text style={styles.tagline}>Drive. Earn. Grow.</Text>
        </View>
        <View style={styles.hero}>
          <View style={styles.heroPill}><View style={styles.onlineDot} /><Text style={styles.heroPillText}>YOUR NEXT CHAPTER STARTS HERE</Text></View>
          <Text style={styles.heroTitle}>Your drive.{`\n`}Your <Text style={styles.heroHighlight}>growth.</Text></Text>
          <Text style={styles.heroCopy}>Take the wheel, set your pace, and earn on every journey with Rishiides.</Text>
          <View style={styles.heroArt}>
            <View style={styles.sun} />
            <View style={styles.road} />
            <View style={styles.carBody}>
              <MaterialCommunityIcons name="car-side" size={112} color={navy} />
              <View style={styles.carShine} />
            </View>
            <View style={styles.routeBadge}><MaterialCommunityIcons name="map-marker-path" size={18} color={navy} /><Text style={styles.routeBadgeText}>GO YOUR WAY</Text></View>
          </View>
        </View>
        <View style={styles.landingActions}>
          <Pressable style={styles.primaryButton} onPress={() => router.push("/register")}>
            <Text style={styles.primaryButtonText}>Get started</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color={navy} />
          </Pressable>
          <Pressable style={styles.loginButton} onPress={() => router.push("/login")}>
            <Text style={styles.loginButtonText}>Already driving with us? <Text style={styles.loginButtonBold}>Log in</Text></Text>
          </Pressable>
          <Text style={styles.terms}>By continuing, you agree to our Terms of Service and Privacy Policy.</Text>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

export function LoginScreen() {
  const router = useRouter();
  const { login, loginWithGoogle, register, error } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/dashboard");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "We couldn't sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitGoogle() {
    setGoogleBusy(true);
    setMessage("");
    try {
      if (await loginWithGoogle()) router.replace("/dashboard");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Google sign-in failed. Please try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessage("Enter your email address first.");
      return;
    }
    try {
      await register.resetPassword(email.trim().toLowerCase());
      setMessage("Password reset email sent. Check your inbox.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Password reset could not be sent.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.authScreen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backButton} onPress={() => router.back()}><MaterialCommunityIcons name="arrow-left" size={22} color={navy} /></Pressable>
        <BrandMark />
        <Text style={styles.authTitle}>Welcome back</Text>
        <Text style={styles.authSubtitle}>Log in to get back on the road.</Text>
        <View style={styles.formCard}>
          <Text style={styles.fieldLabel}>Email address</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#A0A8B6" keyboardType="email-address" autoCapitalize="none" />
          <Text style={[styles.fieldLabel, styles.spacedLabel]}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Your password" placeholderTextColor="#A0A8B6" secureTextEntry autoCapitalize="none" />
          <Pressable style={styles.forgot} onPress={() => void resetPassword()}><Text style={styles.forgotText}>Forgot password?</Text></Pressable>
          {message || error ? <Text style={styles.fieldError}>{message || error}</Text> : null}
          <Pressable style={[styles.primaryButton, (busy || googleBusy) && styles.disabled]} disabled={busy || googleBusy} onPress={() => void submit()}>
            {busy ? <ActivityIndicator color={navy} /> : <><Text style={styles.primaryButtonText}>Log in</Text><MaterialCommunityIcons name="arrow-right" size={20} color={navy} /></>}
          </Pressable>
          <View style={styles.authDivider}><View style={styles.authDividerLine} /><Text style={styles.authDividerText}>OR</Text><View style={styles.authDividerLine} /></View>
          <Pressable
            accessibilityRole="button"
            style={[styles.googleButton, (busy || googleBusy) && styles.disabled]}
            disabled={busy || googleBusy}
            onPress={() => void submitGoogle()}
          >
            {googleBusy ? <ActivityIndicator color={navy} /> : <><MaterialCommunityIcons name="google" size={19} color={navy} /><Text style={styles.googleButtonText}>Continue with Google</Text></>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function RegistrationScreen() {
  const router = useRouter();
  const { driver, register: actions } = useSession();
  const resumeMode = driver?.registrationComplete === false;
  const [step, setStep] = useState(resumeMode ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [verifiedAccount, setVerifiedAccount] = useState<{ customToken: string; uid: string } | null>(null);
  const {
    control,
    getValues,
    trigger,
    handleSubmit,
  } = useForm<Registration>({
    defaultValues: resumeMode ? {
      ...defaults,
      fullName: driver.fullName,
      phone: driver.phone,
      email: driver.email,
      vehicleType: driver.vehicleType,
      vehicleNumber: driver.vehicleNumber,
      vehicleModel: driver.vehicleModel,
      vehicleColour: driver.vehicleColour,
    } : defaults,
    resolver: zodResolver(registrationSchema),
    mode: "onTouched",
  });

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const steps = ["Personal", "Documents", "Vehicle", resumeMode ? "Submit" : "Verify"];
  const fields: (keyof Registration)[][] = [
    ["fullName", "phone", "email", "password", "confirmPassword"],
    ["licenseNumber", "licenseFront", "licenseBack", "aadhaarNumber", "aadhaarFront", "aadhaarBack", "profilePhoto"],
    ["vehicleType", "vehicleNumber", "vehicleModel", "vehicleColour", "vehiclePhoto"],
    ["otp"],
  ];

  async function next() {
    const valid = await trigger(fields[step]);
    if (valid) {
      setErrorMessage("");
      setStep((value) => Math.min(value + 1, 3));
    }
  }

  async function sendOtp() {
    if (cooldown > 0) return;
    const valid = await trigger(["email", "fullName"]);
    if (!valid) {
      setStep(0);
      return;
    }
    setBusy(true);
    setErrorMessage("");
    try {
      await actions.requestOtp(getValues("email").trim().toLowerCase(), getValues("fullName").trim());
      setOtpSent(true);
      setCooldown(60);
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "We couldn't send your code.");
    } finally {
      setBusy(false);
    }
  }

  async function finish(values: Registration) {
    if (!resumeMode && !otpSent) {
      setErrorMessage("Request an email code before verifying your account.");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    try {
      if (resumeMode && !driver) throw new Error("Your signed-in driver profile could not be loaded.");
      const account = resumeMode
        ? { uid: driver.uid, customToken: "" }
        : verifiedAccount ?? await actions.verifyOtp({
        email: values.email.trim().toLowerCase(),
        otp: values.otp,
        fullName: values.fullName.trim(),
        phone: values.phone,
        password: values.password,
        vehicleType: values.vehicleType,
        vehicleNumber: values.vehicleNumber.trim().toUpperCase(),
        vehicleModel: values.vehicleModel.trim(),
        vehicleColour: values.vehicleColour.trim(),
        licenseNumber: values.licenseNumber.trim().toUpperCase(),
        aadhaarNumber: values.aadhaarNumber,
      });
      if (!resumeMode && !verifiedAccount) setVerifiedAccount(account);
      if (!resumeMode) await actions.signInWithToken(account.customToken);
      const images: Record<string, Photo> = {
        licenseFront: values.licenseFront,
        licenseBack: values.licenseBack,
        aadhaarFront: values.aadhaarFront,
        aadhaarBack: values.aadhaarBack,
        profilePhoto: values.profilePhoto,
        vehiclePhoto: values.vehiclePhoto,
      };
      const paths: Record<string, string> = {};
      for (const [name, photo] of Object.entries(images)) {
        if (!photo) throw new Error(`Missing ${name} image`);
        const blob = await (await fetch(photo.uri)).blob();
        const path = `drivers/${account.uid}/verification/${name}`;
        await uploadBytes(ref(storage, path), blob, { contentType: photo.mimeType ?? "image/jpeg" });
        paths[name] = path;
      }
      await actions.finalizeRegistration({
        uid: account.uid,
        paths,
        vehicleType: values.vehicleType,
        vehicleNumber: values.vehicleNumber.trim().toUpperCase(),
        vehicleModel: values.vehicleModel.trim(),
        vehicleColour: values.vehicleColour.trim(),
        licenseNumber: values.licenseNumber.trim().toUpperCase(),
        aadhaarNumber: values.aadhaarNumber,
      });
      actions.completeRegistration();
      router.replace("/dashboard");
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Registration could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitResume() {
    const valid = await trigger([
      "licenseNumber", "licenseFront", "licenseBack", "aadhaarNumber", "aadhaarFront",
      "aadhaarBack", "profilePhoto", "vehicleType", "vehicleNumber", "vehicleModel",
      "vehicleColour", "vehiclePhoto",
    ]);
    if (valid) await finish(getValues());
  }

  const photo = (name: keyof Registration, label: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <PhotoPicker label={label} value={value as Photo} onChange={onChange} error={error?.message} />
      )}
    />
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.registrationScreen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.registrationHeader}>
          <Pressable style={styles.backButton} onPress={step > (resumeMode ? 1 : 0) ? () => setStep((value) => value - 1) : () => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={navy} />
          </Pressable>
          <View style={styles.stepCount}><Text style={styles.stepCountText}>{step + 1} <Text style={styles.stepCountMuted}>/ 4</Text></Text></View>
        </View>
        <View style={styles.progressTrack}>{steps.map((item, index) => <View key={item} style={[styles.progressSegment, index <= step && styles.progressActive]} />)}</View>
        <ScrollView contentContainerStyle={styles.registrationContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepEyebrow}>DRIVER APPLICATION · {steps[step].toUpperCase()}</Text>
          <Text style={styles.authTitle}>{["Let's get to know you.", "A few important documents.", "Tell us about your ride.", resumeMode ? "Ready to submit?" : "Verify your email."][step]}</Text>
          <Text style={styles.authSubtitle}>{["Your details help us set up your driver profile.", "Your information is encrypted and used only for verification.", "Make sure your vehicle details match your documents.", resumeMode ? "Review your documents and submit your application for verification." : "We'll send a six-digit code to confirm your email."][step]}</Text>
          <View style={styles.formCard}>
            {step === 0 && <>
              <Field control={control} name="fullName" label="Full name" placeholder="As shown on your ID" autoCapitalize="words" />
              <Field control={control} name="phone" label="Mobile number" placeholder="+91 98765 43210" keyboardType="phone-pad" />
              <Field control={control} name="email" label="Email address" placeholder="you@example.com" keyboardType="email-address" />
              <Field control={control} name="password" label="Create password" placeholder="At least 12 characters" secureTextEntry />
              <Field control={control} name="confirmPassword" label="Confirm password" placeholder="Re-enter your password" secureTextEntry />
            </>}
            {step === 1 && <>
              <Field control={control} name="licenseNumber" label="Driving licence number" placeholder="Enter licence number" autoCapitalize="characters" />
              {photo("licenseFront", "Driving licence · front")}
              {photo("licenseBack", "Driving licence · back")}
              <Field control={control} name="aadhaarNumber" label="Aadhaar number" placeholder="12-digit Aadhaar number" keyboardType="number-pad" />
              {photo("aadhaarFront", "Aadhaar card · front")}
              {photo("aadhaarBack", "Aadhaar card · back")}
              {photo("profilePhoto", "Profile photograph")}
              <View style={styles.privacyNote}><MaterialCommunityIcons name="lock-outline" size={17} color={navySoft} /><Text style={styles.privacyText}>Your identity documents are private and visible only to authorized verification staff.</Text></View>
            </>}
            {step === 2 && <>
              <Text style={styles.fieldLabel}>Vehicle type</Text>
              <Controller control={control} name="vehicleType" render={({ field: { value, onChange } }) => (
                <View style={styles.vehicleTypes}>{(["car", "bike", "auto"] as const).map((type) => (
                  <Pressable key={type} onPress={() => onChange(type)} style={[styles.vehicleType, value === type && styles.vehicleTypeSelected]}>
                    <MaterialCommunityIcons name={type === "car" ? "car-side" : type === "bike" ? "motorbike" : "rickshaw"} size={22} color={value === type ? navy : muted} />
                    <Text style={[styles.vehicleTypeText, value === type && styles.vehicleTypeTextSelected]}>{type.toUpperCase()}</Text>
                  </Pressable>
                ))}</View>
              )} />
              <Field control={control} name="vehicleNumber" label="Registration number" placeholder="e.g. KA 03 AB 1234" autoCapitalize="characters" />
              <Field control={control} name="vehicleModel" label="Vehicle model" placeholder="e.g. Maruti Swift" autoCapitalize="words" />
              <Field control={control} name="vehicleColour" label="Vehicle colour" placeholder="e.g. Pearl white" autoCapitalize="words" />
              {photo("vehiclePhoto", "Vehicle photograph")}
            </>}
            {step === 3 && resumeMode && <View style={styles.privacyNote}><MaterialCommunityIcons name="shield-check-outline" size={18} color={navySoft} /><Text style={styles.privacyText}>Your email is already verified. Re-enter your document details and upload the images to finish your application.</Text></View>}
            {step === 3 && !resumeMode && <>
              <View style={styles.emailBadge}><MaterialCommunityIcons name="email-check-outline" size={24} color={navy} /><View style={{ flex: 1 }}><Text style={styles.emailBadgeLabel}>CODE WILL BE SENT TO</Text><Text style={styles.emailBadgeAddress}>{getValues("email")}</Text></View></View>
              <Text style={styles.otpIntro}>Enter the six-digit code from your email to submit your application.</Text>
              <Field control={control} name="otp" label="Email verification code" placeholder="000000" keyboardType="number-pad" />
              <Pressable style={styles.resendButton} disabled={busy || cooldown > 0} onPress={() => void sendOtp()}>
                <Text style={[styles.resendText, cooldown > 0 && styles.resendDisabled]}>{cooldown > 0 ? `Resend code in ${cooldown}s` : otpSent ? "Resend verification code" : "Send verification code"}</Text>
              </Pressable>
              {!otpSent ? <Text style={styles.otpHint}>A code is valid for 10 minutes. You can resend it after 60 seconds.</Text> : <Text style={styles.otpHint}>Code sent. Check your inbox and spam folder.</Text>}
            </>}
            {errorMessage ? <Text style={styles.fieldError}>{errorMessage}</Text> : null}
            <Pressable
              style={[styles.primaryButton, busy && styles.disabled]}
              disabled={busy}
              onPress={step < 3 ? () => void next() : resumeMode ? () => void submitResume() : () => void handleSubmit((values) => finish(values))()}
            >
              {busy ? <ActivityIndicator color={navy} /> : <><Text style={styles.primaryButtonText}>{step === 3 ? resumeMode ? "Submit application" : "Verify & submit" : "Continue"}</Text><MaterialCommunityIcons name="arrow-right" size={20} color={navy} /></>}
            </Pressable>
            {step === 3 ? <Text style={styles.terms}>Your application will be reviewed before you can go online.</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RideCard({ ride, onAccept, onStatus, busy }: { ride: Ride; onAccept?: () => void; onStatus?: (status: string) => void; busy?: boolean }) {
  const active = Boolean(onStatus);
  return (
    <View style={styles.rideCard}>
      <View style={styles.rideCardTop}><View style={styles.rideRequestLabel}><View style={styles.onlineDot} /><Text style={styles.rideRequestText}>{active ? ride.status.replace("_", " ").toUpperCase() : "NEW RIDE REQUEST"}</Text></View><Text style={styles.rideFare}>₹{Math.round(ride.fare ?? 0)}</Text></View>
      <View style={styles.routePoint}><View style={styles.pickupPin} /><View style={styles.routeInfo}><Text style={styles.routeLabel}>PICKUP</Text><Text style={styles.routeAddress}>{ride.pickup}</Text></View></View>
      <View style={styles.routeConnector} />
      <View style={styles.routePoint}><View style={styles.dropPin} /><View style={styles.routeInfo}><Text style={styles.routeLabel}>DROP-OFF</Text><Text style={styles.routeAddress}>{ride.destination}</Text></View></View>
      {ride.passengerName ? <Text style={styles.riderName}><MaterialCommunityIcons name="account-outline" size={17} color={muted} />  {ride.passengerName}</Text> : null}
      {onAccept ? <Pressable style={[styles.rideAction, busy && styles.disabled]} disabled={busy} onPress={onAccept}><Text style={styles.rideActionText}>{busy ? "Accepting…" : "Accept ride"}</Text><MaterialCommunityIcons name="arrow-right" size={19} color={navy} /></Pressable> : null}
      {onStatus && <View style={styles.rideActionRow}>
        {ride.status === "accepted" && <Pressable style={styles.rideAction} onPress={() => onStatus("driver_arriving")}><Text style={styles.rideActionText}>On my way</Text></Pressable>}
        {ride.status === "driver_arriving" && <Pressable style={styles.rideAction} onPress={() => onStatus("in_progress")}><Text style={styles.rideActionText}>Start ride</Text></Pressable>}
        {ride.status === "in_progress" && <Pressable style={styles.rideAction} onPress={() => onStatus("completed")}><Text style={styles.rideActionText}>Complete ride</Text></Pressable>}
      </View>}
    </View>
  );
}

export function DashboardScreen() {
  const { driver, loading: sessionLoading, logout, register: actions, refreshDriver, linkGoogle, googleLinked } = useSession();
  const router = useRouter();
  const [rides, setRides] = useState<Ride[]>([]);
  const [activeRides, setActiveRides] = useState<Ride[]>([]);
  const [location, setLocation] = useState<Location.LocationObjectCoords | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRide, setBusyRide] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const approved = driver?.profileStatus === "approved";
  const online = driver?.availabilityStatus === "online";
  const activeRide = useMemo(() => activeRides.find((ride) => ["accepted", "driver_arriving", "in_progress"].includes(ride.status)), [activeRides]);
  const greetingName = driver?.fullName.split(" ")[0] ?? "Driver";

  useEffect(() => {
    if (!driver?.uid || !approved || !online) {
      setRides([]);
      setLoading(false);
      return;
    }
    const unsubscribe = onSnapshot(
      query(collection(db, "rides"), where("status", "==", "requested")),
      (snapshot) => {
        setRides(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Ride)));
        setLoading(false);
      },
      (error) => {
        setProblem(error.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [approved, driver?.uid, online]);

  useEffect(() => {
    if (!driver?.uid) return;
    const unsubscribe = onSnapshot(
      query(
        collection(db, "rides"),
        where("driverUid", "==", driver.uid),
        where("status", "in", ["accepted", "driver_arriving", "in_progress"]),
      ),
      (snapshot) => setActiveRides(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Ride))),
      (error) => setProblem(error.message),
    );
    return unsubscribe;
  }, [driver?.uid]);

  useEffect(() => {
    if (!online && !activeRide) return;
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setProblem("Location permission is needed to share your live position while available for rides.");
        return;
      }
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 30 },
        (position) => {
          setLocation(position.coords);
          void actions.updateLocation(position.coords.latitude, position.coords.longitude).catch((error: unknown) => {
            setProblem(error instanceof Error ? error.message : "Location could not be updated.");
          });
        },
      );
      if (cancelled) subscription.remove();
    })().catch((error: unknown) => setProblem(error instanceof Error ? error.message : "Location tracking could not start."));
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [online, activeRide?.id]);

  useEffect(() => {
    void (async () => {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("driver-rides", {
          name: "Ride requests",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: yellow,
        });
      }
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) return;
      const token = await Notifications.getDevicePushTokenAsync();
      await actions.registerPushToken(token.data);
    })().catch((error: unknown) => setProblem(error instanceof Error ? error.message : "Notifications could not be enabled."));
  }, [driver?.uid]);

  async function toggleAvailability(value: boolean) {
    try {
      await actions.setAvailability(value);
      await refreshDriver();
    } catch (error) {
      Alert.alert("Availability not changed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function acceptRide(rideId: string) {
    setBusyRide(rideId);
    try {
      await actions.acceptRide(rideId);
      await refreshDriver();
    } catch (error) {
      Alert.alert("Ride is no longer available", error instanceof Error ? error.message : "Refresh and try again.");
    } finally {
      setBusyRide("");
    }
  }

  async function updateRide(rideId: string, status: string) {
    try {
      await actions.updateRide(rideId, status);
      await refreshDriver();
    } catch (error) {
      Alert.alert("Ride status not updated", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function leave() {
    try {
      await logout();
    } catch (error) {
      Alert.alert("Unable to sign out", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function connectGoogle() {
    setGoogleBusy(true);
    try {
      if (await linkGoogle()) Alert.alert("Google sign-in connected", "You can now use Google to sign in to Rishiides Driver.");
    } catch (error) {
      Alert.alert("Google sign-in not connected", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  const initialRegion = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : { latitude: 12.9716, longitude: 77.5946, latitudeDelta: 0.08, longitudeDelta: 0.08 };

  if (sessionLoading) return <SafeAreaView style={styles.loader}><ActivityIndicator color={yellow} size="large" /></SafeAreaView>;
  if (!driver) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.dashboard} contentContainerStyle={styles.dashboardContent}>
        <View style={styles.dashboardTop}>
          <View><Text style={styles.dashboardEyebrow}>RISHIIDES DRIVER</Text><Text style={styles.dashboardHello}>Hello, {greetingName}</Text></View>
          <Pressable style={styles.avatarButton} onPress={() => void leave()}><MaterialCommunityIcons name="logout" size={20} color={navy} /></Pressable>
        </View>
        {!driver || driver.registrationComplete === false ? (
          <View style={styles.noticeCard}><View style={styles.noticeIcon}><MaterialCommunityIcons name="file-alert-outline" size={25} color={navy} /></View><Text style={styles.noticeTitle}>Finish your driver application</Text><Text style={styles.noticeCopy}>Your account is secure. Complete the remaining document uploads to submit your application.</Text><Pressable onPress={() => router.push("/register")} style={styles.resumeAction}><Text style={styles.resumeActionText}>Continue application</Text></Pressable><Pressable onPress={() => void leave()} style={styles.incompleteLogout}><Text style={styles.incompleteLogoutText}>Sign out</Text></Pressable></View>
        ) : !approved ? (
          <View style={styles.noticeCard}>
            <View style={styles.noticeIcon}><MaterialCommunityIcons name="shield-check-outline" size={25} color={navy} /></View>
            <Text style={styles.noticeTitle}>{driver?.profileStatus === "rejected" ? "Application needs an update" : "Your profile is under review"}</Text>
            <Text style={styles.noticeCopy}>{driver?.profileStatus === "rejected" ? "Please contact Rishiides support for next steps." : "We’ll notify you as soon as verification is complete. You can go online once approved."}</Text>
          </View>
        ) : null}
        <View style={styles.mapCard}>
          <MapView style={styles.map} initialRegion={initialRegion} showsUserLocation={Boolean(location)} showsMyLocationButton={false}>
            {location ? <Marker coordinate={{ latitude: location.latitude, longitude: location.longitude }} title="Your location" /> : null}
          </MapView>
          <View style={styles.mapOverlay}><MaterialCommunityIcons name="crosshairs-gps" size={17} color={navy} /><Text style={styles.mapOverlayText}>{location ? "Live location" : "Your area"}</Text></View>
        </View>
        <LinearGradient colors={[navy, navySoft]} style={styles.availabilityCard}>
          <View style={styles.availabilityCopy}>
            <View style={styles.availabilityStatus}><View style={[styles.statusDot, online && styles.statusDotOnline]} /><Text style={styles.availabilityEyebrow}>{online ? "YOU'RE ONLINE" : "YOU'RE OFFLINE"}</Text></View>
            <Text style={styles.availabilityTitle}>{online ? "Ready for your next ride?" : "Ready when you are."}</Text>
            <Text style={styles.availabilitySubtitle}>{online ? "Ride requests will appear here." : "Go online to start receiving requests."}</Text>
          </View>
          <Switch value={Boolean(online)} onValueChange={(value) => void toggleAvailability(value)} disabled={!approved || Boolean(activeRide)} trackColor={{ false: "#59647A", true: yellow }} thumbColor={white} />
        </LinearGradient>
        <View style={styles.statsCard}>
          <View style={styles.stat}><Text style={styles.statValue}>{driver?.completedRides ?? 0}</Text><Text style={styles.statLabel}>TRIPS</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.stat}><Text style={styles.statValue}>{activeRides.filter((ride) => ["accepted", "driver_arriving", "in_progress"].includes(ride.status)).length}</Text><Text style={styles.statLabel}>ACTIVE</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.stat}><Text style={styles.statValue}>{driver?.profileStatus === "approved" ? "OK" : "—"}</Text><Text style={styles.statLabel}>PROFILE</Text></View>
        </View>
        {!googleLinked ? (
          <Pressable style={styles.linkGoogleCard} disabled={googleBusy} onPress={() => void connectGoogle()}>
            {googleBusy ? <ActivityIndicator color={navy} /> : <MaterialCommunityIcons name="google" size={22} color={navy} />}
            <View style={styles.linkGoogleCopy}>
              <Text style={styles.linkGoogleTitle}>Link Google sign-in</Text>
              <Text style={styles.linkGoogleSubtitle}>Connect your Google account for quicker login.</Text>
            </View>
            {!googleBusy ? <MaterialCommunityIcons name="chevron-right" size={21} color={muted} /> : null}
          </Pressable>
        ) : null}
        {problem ? <Text style={styles.errorBanner}>{problem}</Text> : null}
        {activeRide ? <View style={styles.section}><Text style={styles.sectionTitle}>Your current ride</Text><RideCard ride={activeRide} onStatus={(status) => void updateRide(activeRide.id, status)} /></View> : null}
        <View style={styles.section}>
          <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Ride requests</Text><View style={styles.liveTag}><View style={styles.onlineDot} /><Text style={styles.liveText}>LIVE</Text></View></View>
          {!approved ? <View style={styles.emptyCard}><MaterialCommunityIcons name="shield-lock-outline" size={25} color={muted} /><Text style={styles.emptyTitle}>Approval required</Text><Text style={styles.emptyCopy}>Ride requests will be available once your profile is approved.</Text></View>
            : !online ? <View style={styles.emptyCard}><MaterialCommunityIcons name="power" size={25} color={muted} /><Text style={styles.emptyTitle}>Go online when you're ready</Text><Text style={styles.emptyCopy}>Switch on availability to receive nearby ride requests.</Text></View>
            : loading ? <ActivityIndicator style={{ margin: 30 }} color={navy} />
              : rides.length === 0 ? <View style={styles.emptyCard}><MaterialCommunityIcons name="map-marker-radius-outline" size={25} color={muted} /><Text style={styles.emptyTitle}>No rides nearby just yet</Text><Text style={styles.emptyCopy}>Keep the app open. New requests arrive here.</Text></View>
                : rides.map((ride) => <RideCard key={ride.id} ride={ride} busy={busyRide === ride.id} onAccept={() => void acceptRide(ride.id)} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function Index() {
  const { driver, loading, registrationInProgress } = useSession();
  if (loading) return <SafeAreaView style={styles.loader}><ActivityIndicator color={yellow} size="large" /></SafeAreaView>;
  if (registrationInProgress) return <Redirect href="/register" />;
  if (driver) return <Redirect href="/dashboard" />;
  return <LandingScreen />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: canvas },
  loader: { flex: 1, backgroundColor: navy, alignItems: "center", justifyContent: "center" },
  landing: { flex: 1, paddingHorizontal: 26, paddingTop: 16, paddingBottom: 12, justifyContent: "space-between" },
  landingBrand: { alignItems: "center", paddingTop: 8 },
  brandMark: { width: 48, height: 48, borderRadius: 16, backgroundColor: yellow, alignItems: "center", justifyContent: "center", position: "relative" },
  brandMarkLarge: { width: 66, height: 66, borderRadius: 22 },
  brandDot: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: white, right: 7, top: 7 },
  brandName: { color: navy, fontSize: 17, fontWeight: "900", letterSpacing: 3, marginTop: 12 },
  brandSub: { color: muted, fontSize: 9, fontWeight: "800", letterSpacing: 2, marginTop: 3 },
  tagline: { color: navySoft, fontSize: 12, fontWeight: "700", letterSpacing: 0.3, marginTop: 7 },
  hero: { marginTop: 10 },
  heroPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", backgroundColor: "#E9EDF5", borderRadius: 20, paddingHorizontal: 11, paddingVertical: 8, gap: 7 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#3EBB7A" },
  heroPillText: { color: navy, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  heroTitle: { color: navy, fontSize: 48, lineHeight: 53, fontWeight: "900", letterSpacing: -1.5, marginTop: 19 },
  heroHighlight: { color: "#C68D11" },
  heroCopy: { color: muted, fontSize: 15, lineHeight: 23, marginTop: 12, maxWidth: 315 },
  heroArt: { height: 178, backgroundColor: "#E8EDF7", borderRadius: 26, marginTop: 21, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  sun: { width: 145, height: 145, borderRadius: 80, backgroundColor: "#F8D77F", position: "absolute", right: 34, top: 15, opacity: 0.75 },
  road: { position: "absolute", height: 25, backgroundColor: "#CFD6E3", bottom: 17, left: -20, right: -20, transform: [{ rotate: "-3deg" }] },
  carBody: { position: "absolute", left: 47, bottom: 30 },
  carShine: { position: "absolute", left: 32, right: 17, top: 38, height: 5, borderRadius: 4, backgroundColor: yellow },
  routeBadge: { position: "absolute", top: 19, left: 18, backgroundColor: white, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6 },
  routeBadgeText: { color: navy, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  landingActions: { gap: 9 },
  primaryButton: { backgroundColor: yellow, minHeight: 54, borderRadius: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, paddingHorizontal: 18 },
  primaryButtonText: { color: navy, fontSize: 15, fontWeight: "800" },
  googleButton: { backgroundColor: white, minHeight: 54, borderRadius: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: border },
  googleButtonText: { color: navy, fontSize: 14, fontWeight: "800" },
  authDivider: { flexDirection: "row", alignItems: "center", gap: 11 },
  authDividerLine: { height: 1, backgroundColor: border, flex: 1 },
  authDividerText: { color: muted, fontSize: 10, fontWeight: "800" },
  loginButton: { alignItems: "center", paddingVertical: 11 },
  loginButtonText: { color: muted, fontSize: 13 },
  loginButtonBold: { color: navy, fontWeight: "800" },
  terms: { color: "#929BAC", textAlign: "center", fontSize: 10, lineHeight: 15, marginHorizontal: 18, marginTop: 2 },
  authScreen: { flex: 1, paddingHorizontal: 24, paddingTop: 9 },
  backButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: white, borderWidth: 1, borderColor: border },
  authTitle: { color: navy, fontSize: 29, lineHeight: 35, fontWeight: "900", letterSpacing: -0.5, marginTop: 20 },
  authSubtitle: { color: muted, fontSize: 14, lineHeight: 21, marginTop: 6 },
  formCard: { backgroundColor: white, borderRadius: 21, padding: 18, marginTop: 24, borderWidth: 1, borderColor: "#EDF0F5", gap: 13 },
  fieldWrap: { gap: 7 },
  fieldLabel: { color: navy, fontSize: 12, fontWeight: "800", marginBottom: 7 },
  spacedLabel: { marginTop: 3 },
  input: { borderWidth: 1, borderColor: border, backgroundColor: white, borderRadius: 12, minHeight: 49, paddingHorizontal: 14, color: navy, fontSize: 14 },
  inputError: { borderColor: "#D85151" },
  fieldError: { color: "#C33737", fontSize: 11, marginTop: 3 },
  forgot: { alignSelf: "flex-end", paddingVertical: 2 },
  forgotText: { color: navySoft, fontWeight: "700", fontSize: 12 },
  registrationScreen: { flex: 1 },
  registrationHeader: { paddingHorizontal: 22, paddingTop: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepCount: { backgroundColor: white, borderRadius: 14, borderWidth: 1, borderColor: border, paddingHorizontal: 12, paddingVertical: 8 },
  stepCountText: { color: navy, fontSize: 12, fontWeight: "900" },
  stepCountMuted: { color: muted, fontWeight: "600" },
  progressTrack: { flexDirection: "row", gap: 6, marginHorizontal: 22, marginTop: 17 },
  progressSegment: { height: 4, borderRadius: 4, flex: 1, backgroundColor: "#DDE2EB" },
  progressActive: { backgroundColor: yellow },
  registrationContent: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 28 },
  stepEyebrow: { color: "#A77A12", fontSize: 10, letterSpacing: 1.1, fontWeight: "900" },
  photoField: { marginTop: 3 },
  photoButton: { minHeight: 57, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: border, borderRadius: 13, backgroundColor: white },
  photoPreview: { width: 38, height: 38, borderRadius: 8 },
  photoButtonText: { color: navy, fontSize: 13, fontWeight: "700", flex: 1 },
  privacyNote: { backgroundColor: "#F3F6FB", borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  privacyText: { flex: 1, color: muted, fontSize: 11, lineHeight: 16 },
  vehicleTypes: { flexDirection: "row", gap: 9, marginBottom: 3 },
  vehicleType: { flex: 1, backgroundColor: white, borderWidth: 1, borderColor: border, borderRadius: 13, minHeight: 69, alignItems: "center", justifyContent: "center", gap: 4 },
  vehicleTypeSelected: { backgroundColor: "#FFF7DF", borderColor: yellow },
  vehicleTypeText: { color: muted, fontSize: 10, fontWeight: "800" },
  vehicleTypeTextSelected: { color: navy },
  emailBadge: { backgroundColor: "#F3F6FB", borderRadius: 13, padding: 13, flexDirection: "row", gap: 11, alignItems: "center" },
  emailBadgeLabel: { color: muted, fontSize: 9, letterSpacing: 0.7, fontWeight: "800" },
  emailBadgeAddress: { color: navy, fontWeight: "800", fontSize: 13, marginTop: 4 },
  otpIntro: { color: muted, fontSize: 13, lineHeight: 19, marginVertical: 2 },
  resendButton: { alignSelf: "flex-start", paddingVertical: 4 },
  resendText: { color: navy, fontSize: 12, fontWeight: "800" },
  resendDisabled: { color: muted },
  otpHint: { color: muted, fontSize: 11, lineHeight: 16 },
  disabled: { opacity: 0.6 },
  dashboard: { flex: 1, backgroundColor: canvas },
  dashboardContent: { paddingHorizontal: 18, paddingBottom: 32 },
  dashboardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16 },
  dashboardEyebrow: { color: muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  dashboardHello: { color: navy, fontSize: 25, fontWeight: "900", marginTop: 4 },
  avatarButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: white, alignItems: "center", justifyContent: "center", borderColor: border, borderWidth: 1 },
  mapCard: { height: 180, borderRadius: 20, overflow: "hidden", marginTop: 4, backgroundColor: "#E2E9F2" },
  map: { ...StyleSheet.absoluteFill },
  mapOverlay: { position: "absolute", bottom: 11, left: 11, backgroundColor: white, borderRadius: 11, paddingVertical: 7, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  mapOverlayText: { color: navy, fontSize: 10, fontWeight: "800" },
  availabilityCard: { marginTop: 12, borderRadius: 20, padding: 17, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  availabilityCopy: { flex: 1, paddingRight: 8 },
  availabilityStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#AAB2C0" },
  statusDotOnline: { backgroundColor: "#55D38C" },
  availabilityEyebrow: { color: "#D0D6E2", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  availabilityTitle: { color: white, fontSize: 16, fontWeight: "800", marginTop: 8 },
  availabilitySubtitle: { color: "#B9C1D0", fontSize: 11, marginTop: 4 },
  statsCard: { marginTop: 12, backgroundColor: white, borderWidth: 1, borderColor: border, borderRadius: 18, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  linkGoogleCard: { backgroundColor: white, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, marginTop: 13, borderWidth: 1, borderColor: border, flexDirection: "row", alignItems: "center", gap: 12 },
  linkGoogleCopy: { flex: 1 },
  linkGoogleTitle: { color: navy, fontSize: 13, fontWeight: "800" },
  linkGoogleSubtitle: { color: muted, fontSize: 11, marginTop: 3 },
  stat: { alignItems: "center", flex: 1 },
  statValue: { color: navy, fontSize: 20, fontWeight: "900" },
  statLabel: { color: muted, fontSize: 8, letterSpacing: 0.6, fontWeight: "800", marginTop: 4 },
  statDivider: { width: 1, height: 28, backgroundColor: border },
  section: { marginTop: 20 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: { color: navy, fontSize: 17, fontWeight: "900", marginBottom: 10 },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#E5F6ED", borderRadius: 20, paddingVertical: 5, paddingHorizontal: 9, marginBottom: 8 },
  liveText: { color: "#228550", fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  rideCard: { backgroundColor: white, borderRadius: 18, padding: 15, borderWidth: 1, borderColor: border, marginBottom: 10 },
  rideCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 },
  rideRequestLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  rideRequestText: { color: muted, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  rideFare: { color: navy, fontSize: 19, fontWeight: "900" },
  routePoint: { flexDirection: "row", alignItems: "center", gap: 11 },
  pickupPin: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#3EBB7A", marginHorizontal: 3 },
  dropPin: { width: 10, height: 10, borderRadius: 2, backgroundColor: yellow, marginHorizontal: 3 },
  routeInfo: { flex: 1 },
  routeLabel: { color: muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  routeAddress: { color: navy, fontSize: 13, fontWeight: "700", marginTop: 3 },
  routeConnector: { height: 15, width: 1, borderLeftWidth: 1, borderColor: "#CFD5DF", borderStyle: "dashed", marginLeft: 7 },
  riderName: { color: muted, fontSize: 11, marginTop: 14 },
  rideAction: { backgroundColor: yellow, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 15, flex: 1 },
  rideActionText: { color: navy, fontWeight: "900", fontSize: 12 },
  rideActionRow: { flexDirection: "row", gap: 8 },
  emptyCard: { backgroundColor: white, borderWidth: 1, borderColor: border, borderRadius: 18, padding: 23, alignItems: "center" },
  emptyTitle: { color: navy, fontSize: 14, fontWeight: "800", marginTop: 9 },
  emptyCopy: { color: muted, textAlign: "center", fontSize: 11, lineHeight: 17, marginTop: 5, maxWidth: 250 },
  noticeCard: { backgroundColor: "#FFF8E5", borderColor: "#F4D887", borderWidth: 1, borderRadius: 17, padding: 17, alignItems: "center", marginBottom: 12 },
  noticeIcon: { width: 47, height: 47, alignItems: "center", justifyContent: "center", backgroundColor: yellow, borderRadius: 15, marginBottom: 9 },
  noticeTitle: { color: navy, fontSize: 15, fontWeight: "900", textAlign: "center", marginTop: 8 },
  noticeCopy: { color: "#6E7583", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  incompleteLogout: { marginTop: 14, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 12, backgroundColor: white },
  incompleteLogoutText: { color: navy, fontSize: 12, fontWeight: "800" },
  resumeAction: { marginTop: 13, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: yellow },
  resumeActionText: { color: navy, fontSize: 12, fontWeight: "900" },
  errorBanner: { color: "#B83E3E", fontSize: 11, marginTop: 10 },
});
