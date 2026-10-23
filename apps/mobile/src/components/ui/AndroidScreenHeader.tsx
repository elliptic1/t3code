import { AppText } from "./AppText";
import { AppActivityIndicator } from "./AppActivityIndicator";
import { Column, Row, Text as NativeText, RNHostView } from "@expo/ui/jetpack-compose";
import { weight } from "@expo/ui/jetpack-compose/modifiers";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { SymbolView, type AppSymbolName } from "./AppSymbol";
import { useAndroidControlSizing } from "./useAndroidControlSizing";
import { NativeAppBar } from "./NativeAppBar.android";
import { IconButton } from "./IconButton";
import { AndroidAnchoredMenu } from "./AndroidAnchoredMenu";
import { splitAndroidHeaderActions } from "./headerMenu.android";
import { useScaledTextRole } from "../../features/settings/appearance/useScaledTextRole";
import { useToolbarLayout } from "./useToolbarLayout";
import { useControlTheme } from "./useControlTheme";

export interface AndroidHeaderAction {
  readonly accessibilityLabel: string;
  readonly icon: AppSymbolName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly selected?: boolean;
  readonly destructive?: boolean;
  readonly overflowOnly?: boolean;
  readonly badge?: string;
  readonly alwaysVisible?: boolean;
}

export function AndroidHeaderIconButton(props: {
  readonly accessibilityLabel: string;
  readonly icon: AppSymbolName;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly selected?: boolean;
}) {
  return <IconButton {...props} tintColorClassName="accent-header-foreground" />;
}

/**
 * An action with a short status (e.g. usage left) shown beside its icon, not over it: a corner
 * overlay drawn on the Compose button hid the icon inside the native app bar.
 */
function AndroidHeaderBadgeButton(props: { readonly action: AndroidHeaderAction }) {
  const { iconSize, buttonSize } = useAndroidControlSizing();
  const { action } = props;
  return (
    <Pressable
      accessibilityLabel={action.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(action.disabled), selected: action.selected }}
      android_ripple={{ borderless: false, foreground: true }}
      disabled={action.disabled}
      hitSlop={4}
      onPress={action.onPress}
      className="flex-row items-center gap-1 overflow-hidden rounded-full px-2"
      style={{ height: buttonSize }}
    >
      <SymbolView
        name={action.icon}
        size={iconSize}
        tintColorClassName={action.disabled ? "accent-icon-subtle" : "accent-header-foreground"}
        type="monochrome"
      />
      <AppText className="text-xs font-t3-medium tabular-nums text-header-foreground">
        {action.badge}
      </AppText>
    </Pressable>
  );
}

export function AndroidScreenHeader(props: {
  readonly title: string;
  readonly titleContent?: ReactNode;
  readonly subtitle?: string | null;
  readonly actions?: ReadonlyArray<AndroidHeaderAction>;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onBack?: () => void;
  readonly embedded?: boolean;
  readonly hideBottomBorder?: boolean;
  /** One row with the subtitle after the title, for screens short on height. */
  readonly compact?: boolean;
}) {
  const { colors } = useControlTheme();
  const titleTypography = useScaledTextRole("title");
  const subtitleTypography = useScaledTextRole("label");
  const { paddingTop, paddingBottom } = useToolbarLayout(props.embedded);
  const [headerWidth, setHeaderWidth] = useState(0);
  const { visibleActions, overflowActions } = splitAndroidHeaderActions(
    props.actions ?? [],
    headerWidth >= 600,
  );

  return (
    <View
      onLayout={(event) => setHeaderWidth(event.nativeEvent.layout.width)}
      className="border-b border-header-border bg-header"
      style={{
        paddingTop,
        paddingBottom,
        borderBottomWidth: props.hideBottomBorder ? 0 : undefined,
      }}
    >
      <NativeAppBar
        singleLine={props.compact}
        navigationIcon={
          props.onBack || props.leading ? (
            <View collapsable={false} className="flex-row items-center">
              {props.onBack ? (
                <IconButton
                  accessibilityLabel="Navigate up"
                  icon="arrow.left"
                  tintColorClassName="accent-header-foreground"
                  onPress={props.onBack}
                />
              ) : null}

              {props.leading}
            </View>
          ) : undefined
        }
        title={
          props.titleContent ? (
            <RNHostView matchContents={{ vertical: true }}>
              <View collapsable={false}>{props.titleContent}</View>
            </RNHostView>
          ) : !props.subtitle ? (
            <NativeText
              color={colors["--color-header-foreground"]}
              maxLines={1}
              overflow="ellipsis"
              style={titleTypography}
            >
              {props.title}
            </NativeText>
          ) : props.compact ? (
            <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }}>
              <NativeText
                color={colors["--color-header-foreground"]}
                maxLines={1}
                overflow="ellipsis"
                style={titleTypography}
              >
                {props.title}
              </NativeText>
              <NativeText
                color={colors["--color-foreground-muted"]}
                maxLines={1}
                overflow="ellipsis"
                style={subtitleTypography}
                modifiers={[weight(1)]}
              >
                {props.subtitle}
              </NativeText>
            </Row>
          ) : (
            <Column>
              <NativeText
                color={colors["--color-header-foreground"]}
                maxLines={1}
                overflow="ellipsis"
                style={titleTypography}
              >
                {props.title}
              </NativeText>
              {props.subtitle ? (
                <NativeText
                  color={colors["--color-foreground-muted"]}
                  maxLines={1}
                  overflow="ellipsis"
                  style={subtitleTypography}
                >
                  {props.subtitle}
                </NativeText>
              ) : null}
            </Column>
          )
        }
        actions={
          visibleActions.length > 0 || overflowActions.length > 0 || props.trailing ? (
            <View collapsable={false} className="flex-row items-center">
              {visibleActions.map((action) =>
                action.loading ? (
                  <View
                    key={action.accessibilityLabel}
                    accessibilityLabel={action.accessibilityLabel}
                    className="size-12 items-center justify-center"
                  >
                    <AppActivityIndicator colorClassName="accent-header-foreground" />
                  </View>
                ) : action.badge ? (
                  <AndroidHeaderBadgeButton key={action.accessibilityLabel} action={action} />
                ) : (
                  <AndroidHeaderIconButton
                    key={action.accessibilityLabel}
                    accessibilityLabel={action.accessibilityLabel}
                    disabled={action.disabled}
                    selected={action.selected}
                    icon={action.icon}
                    onPress={action.onPress}
                  />
                ),
              )}
              {overflowActions.length > 0 ? (
                <AndroidAnchoredMenu
                  actions={overflowActions.map((action, index) => ({
                    id: String(index),
                    title: action.accessibilityLabel,
                    attributes: {
                      disabled: Boolean(action.disabled),
                      destructive: action.destructive,
                      state: action.selected ? "on" : undefined,
                    },
                  }))}
                  onPressAction={({ nativeEvent }) =>
                    overflowActions[Number(nativeEvent.event)]?.onPress()
                  }
                >
                  {(open) => (
                    <IconButton
                      accessibilityLabel="More actions"
                      icon="ellipsis"
                      tintColorClassName="accent-header-foreground"
                      onPress={open}
                    />
                  )}
                </AndroidAnchoredMenu>
              ) : null}
              {props.trailing}
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

export function AndroidSheetHeader(
  props: Omit<Parameters<typeof AndroidScreenHeader>[0], "embedded">,
) {
  return <AndroidScreenHeader {...props} embedded />;
}
