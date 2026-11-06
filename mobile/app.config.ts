import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Rishiides Driver",
  slug: "rishiides-driver",
  scheme: "rishiidesdriver",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  plugins: [
    "expo-router",
    "expo-font",
    "expo-secure-store",
    "@react-native-google-signin/google-signin",
    ["expo-image-picker", {
      photosPermission: "Allow Rishiides Driver to select your verification and vehicle photos.",
    }],
    ["expo-location", {
      locationWhenInUsePermission: "Rishiides Driver uses your location to show nearby rides and share your position during active work.",
    }],
    ["expo-notifications", {
      defaultChannel: "driver-rides",
      enableBackgroundRemoteNotifications: false,
    }],
  ],
  android: {
    package: "com.rishiides.driver",
    adaptiveIcon: {
      backgroundColor: "#F5BE35",
    },
    ...(process.env.GOOGLE_SERVICES_JSON_PATH
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON_PATH }
      : {}),
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
      },
    },
  },
  ios: {
    bundleIdentifier: "com.rishiides.driver",
    supportsTablet: false,
    ...(process.env.GOOGLE_SERVICES_PLIST_PATH
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_PLIST_PATH }
      : {}),
  },
  experiments: { typedRoutes: true },
});
