import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  supportsAndroidAgentNotifications,
  supportsAndroidUsageResetReminders,
} from "./androidNotifications";

export function supportsAgentAwarenessPush() {
  return Platform.OS === "android"
    ? supportsAndroidAgentNotifications()
    : Platform.OS === "ios" && Constants.expoConfig?.extra?.iosPersonalTeamBuild !== true;
}

export function supportsUsageResetReminders() {
  return (
    supportsAgentAwarenessPush() &&
    (Platform.OS !== "android" || supportsAndroidUsageResetReminders())
  );
}
