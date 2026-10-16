import { NATIVE_WORKSPACE_COLUMNS_SUPPORTED } from "../native/NativeWorkspaceColumns";
import Constants from "expo-constants";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Platform, View } from "react-native";

import { AppText as Text } from "./ui/AppText";
import { T3Wordmark } from "./T3Wordmark";
import { IPAD_HOME_TITLE_OFFSET } from "../lib/layoutMetrics";
import { formatMobileBuildLabel, resolveMobileStageLabel } from "../lib/mobileBranding";
import { useAndroidControlSizing } from "./ui/useAndroidControlSizing";

export function brandTitleOffset(): number {
  if (Platform.OS !== "ios") return 0;
  return Platform.isPad && !NATIVE_WORKSPACE_COLUMNS_SUPPORTED ? IPAD_HOME_TITLE_OFFSET : 0;
}

export function CompactBrandTitle(
  props: {
    readonly allowFontScaling?: boolean;
    readonly accessibilityLabel?: string;
  } = {},
) {
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);
  const buildLabel = formatMobileBuildLabel(Constants.expoConfig?.extra?.buildTimestamp);
  const titleOffset = brandTitleOffset();
  const { scale } = useAndroidControlSizing();

  return (
    <View
      aria-level={1}
      accessibilityLabel={
        props.accessibilityLabel ??
        (buildLabel ? `T3 Code, Threads, ${buildLabel}` : "T3 Code, Threads")
      }
      accessible
      role="heading"
      className="items-start"
      style={{ marginLeft: titleOffset }}
    >
      <View
        className="flex-row items-center gap-1.5"
        style={Platform.OS === "android" ? { gap: 5.25 * scale } : undefined}
      >
        <T3Wordmark colorClassName="accent-icon" height={Math.round(15 * scale)} />
        <Text
          allowFontScaling={props.allowFontScaling}
          className="font-t3-medium text-foreground-muted"
          style={{ fontSize: 21 * scale, letterSpacing: -0.5 * scale }}
        >
          Code
        </Text>
        <View
          className="rounded-full bg-subtle px-1.5 py-0.5"
          style={
            Platform.OS === "android"
              ? { paddingHorizontal: 5.25 * scale, paddingVertical: 1.75 * scale }
              : undefined
          }
        >
          <Text
            allowFontScaling={props.allowFontScaling}
            className="font-t3-bold text-foreground-muted uppercase"
            style={{ fontSize: 9 * scale, letterSpacing: 0.9 * scale }}
          >
            {stageLabel}
          </Text>
        </View>
      </View>
      {buildLabel ? (
        <Text
          allowFontScaling={props.allowFontScaling}
          className="font-t3-medium text-foreground-muted"
          style={{ fontSize: 10 * scale, lineHeight: 12 * scale, opacity: 0.75 }}
        >
          {buildLabel}
        </Text>
      ) : null}
    </View>
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: "Threads",
    unstable_headerLeftItems: undefined,
  };
}
