import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import { threadModelUsageSnapshot } from "../threads/threadModelUsage";
import type { RunningUsageReading } from "./runningUsage";

export function runningThreadUsageReadings(
  threads: readonly Pick<
    EnvironmentThreadShell,
    "environmentId" | "modelSelection" | "modelFallback" | "runtime" | "deletedAt"
  >[],
  configurations: ReadonlyMap<EnvironmentId, Pick<ServerConfig, "providers" | "usageLimitSources">>,
  connected: ReadonlySet<EnvironmentId>,
) {
  const active = threads.filter(
    (thread) => thread.deletedAt === null && threadRuntimeIsActive(thread.runtime),
  );
  const readings = new Map<string, RunningUsageReading>();
  const refreshTargets = new Map<
    string,
    {
      environmentId: EnvironmentId;
      instanceId: EnvironmentThreadShell["modelSelection"]["instanceId"];
    }
  >();
  for (const thread of active) {
    const fallback = thread.modelFallback?.fallback;
    const selection =
      fallback && fallback.instanceId === thread.runtime?.providerInstanceId
        ? fallback
        : thread.modelSelection;
    refreshTargets.set(`${thread.environmentId}:${selection.instanceId}`, {
      environmentId: thread.environmentId,
      instanceId: selection.instanceId,
    });
    if (!connected.has(thread.environmentId)) continue;
    const config = configurations.get(thread.environmentId);
    const snapshot = threadModelUsageSnapshot(thread.environmentId, selection, config);
    const provider = config?.providers.find(
      (provider) => provider.instanceId === selection.instanceId,
    );
    if (!snapshot || !provider) continue;
    const name =
      provider.displayName?.trim() ||
      ({ codex: "Codex", claudeAgent: "Claude", cursor: "Cursor", antigravity: "Antigravity" }[
        String(provider.driver)
      ] ??
        String(provider.driver));
    for (const window of snapshot.windows) {
      const key = JSON.stringify([snapshot.identity, window.id, window.kind]);
      const resets = window.members.map((member) => member.window.resetsAt ?? "").sort();
      const reading: RunningUsageReading = {
        key,
        label: `${name} · ${window.label}`,
        remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
        checkedAt: snapshot.checkedAt,
        cycle: JSON.stringify(resets),
        // A pool refills in parts. Only claim a full reset for a single account.
        resetsAt:
          window.members.length === 1 && window.members[0]!.window.resetsAt
            ? Date.parse(window.members[0]!.window.resetsAt!)
            : null,
      };
      if (!readings.has(key) || readings.get(key)!.checkedAt < reading.checkedAt)
        readings.set(key, reading);
    }
  }
  return {
    activeCount: active.length,
    environmentIds: [...new Set(active.map((thread) => thread.environmentId))],
    refreshTargets: [...refreshTargets.values()],
    readings: [...readings.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}
