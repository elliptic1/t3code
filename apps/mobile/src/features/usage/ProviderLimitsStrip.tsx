import { useAtomValue } from "@effect/atom-react";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";

/**
 * Quota left per provider, pooled across accounts and environments like the
 * Usage → Limits view. Each driver shows its tightest window: the one that
 * stops you first. Mirrors the web sidebar's provider limits.
 */
export function ProviderLimitsStrip(props: { readonly onPress: () => void }) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const summaries = useMemo(
    // `now` only feeds pace, which the strip does not show.
    () =>
      collectLimitPools(collectLimitAccounts(presentations), 0).flatMap((pool) =>
        pool.windows.length === 0
          ? []
          : [
              {
                driver: pool.driver,
                remainingPercent: Math.min(...pool.windows.map((w) => w.remainingPercent)),
              },
            ],
      ),
    [presentations],
  );
  if (summaries.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Usage left: ${summaries
        .map((s) => `${s.driver} ${s.remainingPercent}%`)
        .join(", ")}`}
      hitSlop={6}
      onPress={props.onPress}
      className="flex-row items-center gap-2.5 self-end pb-1 pr-3 active:opacity-60"
    >
      {summaries.map((summary) => (
        <View key={summary.driver} className="flex-row items-center gap-1">
          <ProviderIcon provider={summary.driver} size={11} />
          <Text
            allowFontScaling={false}
            className="text-[11px] text-foreground-muted"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {summary.remainingPercent}%
          </Text>
        </View>
      ))}
    </Pressable>
  );
}
