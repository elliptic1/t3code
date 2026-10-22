import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { runningThreadUsageReadings } from "./runningUsageSnapshot";

const environmentId = EnvironmentId.make("desktop");
const instanceId = ProviderInstanceId.make("codex");
const checkedAt = "2026-10-22T18:00:00Z";
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  status: "ready",
  version: null,
  auth: { status: "authenticated" },
  checkedAt,
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt,
    windows: [
      {
        id: "session",
        kind: "session",
        label: "Session",
        usedPercent: 25,
        resetsAt: "2026-10-22T22:00:00Z",
      },
    ],
  },
};
const config = { providers: [provider], usageLimitSources: [] };
const thread = (status: "running" | "completed" = "running") => ({
  environmentId,
  deletedAt: null,
  modelSelection: { instanceId, model: "gpt-6.1" },
  runtime: {
    status,
    activeRunId: null,
    providerInstanceId: instanceId,
    providerName: "Codex",
    lastError: null,
    updatedAt: checkedAt,
  },
});

it("counts parallel threads without duplicating their shared allowance", () => {
  const result = runningThreadUsageReadings(
    [thread(), thread(), thread("completed")],
    new Map([[environmentId, config]]),
    new Set([environmentId]),
  );
  expect(result.activeCount).toBe(2);
  expect(result.readings).toHaveLength(1);
  expect(result.readings[0]?.remainingPercent).toBe(75);
  expect(result.refreshTargets).toHaveLength(1);
});

it("stops reporting work when the final thread finishes and suppresses offline quota", () => {
  const done = runningThreadUsageReadings(
    [thread("completed")],
    new Map([[environmentId, config]]),
    new Set([environmentId]),
  );
  expect(done.activeCount).toBe(0);
  expect(done.readings).toEqual([]);
  const offline = runningThreadUsageReadings(
    [thread()],
    new Map([[environmentId, config]]),
    new Set(),
  );
  expect(offline.activeCount).toBe(1);
  expect(offline.readings).toEqual([]);
});

it("follows the provider currently running a configured fallback", () => {
  const fallbackId = ProviderInstanceId.make("claude");
  const fallbackProvider = {
    ...provider,
    instanceId: fallbackId,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude",
  };
  const primary = thread();
  const fallback = { instanceId: fallbackId, model: "claude-sonnet-4-6" };
  const result = runningThreadUsageReadings(
    [
      {
        ...primary,
        runtime: { ...primary.runtime, providerInstanceId: fallbackId },
        modelFallback: { preferred: primary.modelSelection, fallback },
      },
    ],
    new Map([[environmentId, { providers: [provider, fallbackProvider], usageLimitSources: [] }]]),
    new Set([environmentId]),
  );
  expect(result.readings[0]?.label).toBe("Claude · Session");
  expect(result.refreshTargets[0]?.instanceId).toBe(fallbackId);
});
