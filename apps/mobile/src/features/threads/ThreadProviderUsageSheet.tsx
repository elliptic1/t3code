import type { EnvironmentId, ModelSelection, ServerConfig } from "@t3tools/contracts";
import { useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Sheet } from "../../components/ui/Sheet";
import { useRefreshLimits } from "../usage/UsageLimitsSection";
import { threadModelUsageSnapshot } from "./threadModelUsage";

export function ThreadProviderUsageSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly selection: ModelSelection;
  readonly config: ServerConfig | null;
  readonly onClose: () => void;
}) {
  const environments = useMemo(() => new Set([props.environmentId]), [props.environmentId]);
  const { refreshing, refresh, failedLabels } = useRefreshLimits(environments, true);
  const provider = props.config?.providers.find(
    (entry) => entry.instanceId === props.selection.instanceId,
  );
  const snapshot = threadModelUsageSnapshot(props.environmentId, props.selection, props.config);
  return (
    <Sheet title="Selected provider usage" onClose={props.onClose}>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View className="gap-1">
          <Text className="text-lg font-t3-medium">
            {provider?.displayName ?? props.selection.instanceId}
          </Text>
          <Text className="text-sm text-foreground-muted">{props.selection.model}</Text>
          {provider?.auth.email ? (
            <Text className="text-sm text-foreground-muted">{provider.auth.email}</Text>
          ) : null}
        </View>
        {snapshot ? (
          snapshot.windows.map((window) => (
            <View key={window.id} className="gap-2 rounded-xl bg-card p-4">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm">{window.label}</Text>
                <Text className="font-t3-medium tabular-nums">{window.remainingPercent}% left</Text>
              </View>
              <View className="h-2 flex-row overflow-hidden rounded-full bg-subtle">
                <View className="h-full bg-foreground" style={{ flex: window.remainingPercent }} />
                <View style={{ flex: 100 - window.remainingPercent }} />
              </View>
              {window.resets.map((reset) => (
                <Text
                  key={`${reset.member.account.key}:${reset.at}`}
                  className="text-xs text-foreground-muted"
                >
                  Resets {new Date(reset.at).toLocaleString()}
                </Text>
              ))}
            </View>
          ))
        ) : (
          <Text className="text-sm text-foreground-muted">
            Usage is unavailable for this model’s provider account. Pull down to refresh.
          </Text>
        )}
        {snapshot && Number.isFinite(snapshot.checkedAt) ? (
          <Text className="text-xs text-foreground-muted">
            Last checked {new Date(snapshot.checkedAt).toLocaleString()}
          </Text>
        ) : null}
        {failedLabels.length > 0 ? (
          <Text className="text-sm text-foreground-muted">
            Could not refresh usage. Showing the last available data.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
