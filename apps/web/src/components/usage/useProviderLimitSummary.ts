import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { useMemo } from "react";

import { environmentPresentations } from "../../state/presentation";

export interface ProviderLimitSummary {
  /** Quota left in the tightest window, 0..100: the one that will stop you first. */
  readonly remainingPercent: number;
  readonly windows: ReadonlyArray<{ readonly label: string; readonly remainingPercent: number }>;
}

/**
 * Quota left per provider driver, pooled across accounts and environments the
 * same way the Usage page's limits view is. Drivers that report no usable
 * windows are absent.
 */
export function useProviderLimitSummary(): ReadonlyMap<
  ServerProvider["driver"],
  ProviderLimitSummary
> {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  return useMemo(() => {
    // `now` only feeds pace, which the summary does not show.
    const pools = collectLimitPools(collectLimitAccounts(presentations), 0);
    return new Map(
      pools.flatMap((pool) => {
        const windows = pool.windows.map(({ label, remainingPercent }) => ({
          label,
          remainingPercent,
        }));
        return windows.length === 0
          ? []
          : [
              [
                pool.driver,
                {
                  remainingPercent: Math.min(...windows.map((w) => w.remainingPercent)),
                  windows,
                },
              ] as const,
            ];
      }),
    );
  }, [presentations]);
}

/** "Session 72% left · Weekly 40% left" */
export function describeProviderLimits(summary: ProviderLimitSummary): string {
  return summary.windows
    .map((window) => `${window.label} ${window.remainingPercent}% left`)
    .join(" · ");
}
