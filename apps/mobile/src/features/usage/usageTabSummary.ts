import type { LimitPool } from "@t3tools/shared/usageLimits";

// Keys name the logo the native Usage tab draws in front of each percentage.
const TAB_PROVIDERS = [
  { driver: "claudeAgent", key: "claude" },
  { driver: "codex", key: "codex" },
] as const;

/** One "claude 42%" line per subscription, using its tightest window's quota left. */
export function usageTabLines(pools: readonly LimitPool[]): string[] {
  return TAB_PROVIDERS.flatMap(({ driver, key }) => {
    const windows = pools.find((pool) => pool.driver === driver)?.windows ?? [];
    if (windows.length === 0) return [];
    return [`${key} ${Math.min(...windows.map((window) => window.remainingPercent))}%`];
  });
}
