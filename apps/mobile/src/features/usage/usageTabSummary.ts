import type { LimitPool } from "@t3tools/shared/usageLimits";

const TAB_PROVIDERS = [
  { driver: "claudeAgent", label: "Claude" },
  { driver: "codex", label: "Codex" },
] as const;

/** One "Claude 42%" line per subscription, using its tightest window's quota left. */
export function usageTabLines(pools: readonly LimitPool[]): string[] {
  return TAB_PROVIDERS.flatMap(({ driver, label }) => {
    const windows = pools.find((pool) => pool.driver === driver)?.windows ?? [];
    if (windows.length === 0) return [];
    return [`${label} ${Math.min(...windows.map((window) => window.remainingPercent))}%`];
  });
}
