import { describe, expect, it } from "@effect/vitest";
import { vi, afterEach } from "vite-plus/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as Settings from "../serverSettings.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerConfig from "../config.ts";
import { RELAY_URL_SECRET } from "../cloud/config.ts";
import * as UsageResetReminders from "./UsageResetReminders.ts";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "1970-01-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt: "1970-01-01T00:00:00.000Z",
    windows: [
      {
        id: "five_hour",
        label: "Session",
        kind: "session",
        usedPercent: 50,
        resetsAt: "1970-01-01T01:00:00.000Z",
      },
    ],
  },
};
const window = provider.usageLimits!.windows[0]!;
function withWindow(patch: Partial<typeof window>) {
  return {
    ...provider,
    usageLimits: { ...provider.usageLimits!, windows: [{ ...window, ...patch }] },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("usage reset reminders", () => {
  it("includes the final hour and reports remaining allowance", () => {
    expect(UsageResetReminders.dueUsageResetReminders([provider], 0)).toEqual([
      {
        providerInstanceId: "claudeAgent",
        providerLabel: "Claude",
        windowId: "five_hour",
        resetsAt: window.resetsAt,
        remainingPercent: 50,
      },
    ]);
  });
  it("notifies Claude and Codex regardless of remaining allowance", () => {
    for (const driver of ["claudeAgent", "codex"]) {
      for (const usedPercent of [0, 50.01, 90, 99.5, 100]) {
        const candidate = {
          ...withWindow({ usedPercent }),
          driver: ProviderDriverKind.make(driver),
          instanceId: ProviderInstanceId.make(driver),
          displayName: driver === "codex" ? "Codex" : "Claude",
        };
        expect(UsageResetReminders.dueUsageResetReminders([candidate], 0)).toMatchObject([
          { providerInstanceId: driver, remainingPercent: 100 - usedPercent },
        ]);
      }
    }
  });
  it("skips expired, distant, unsupported and invalid windows", () => {
    for (const patch of [
      { resetsAt: "1970-01-01T00:00:00.000Z" },
      { resetsAt: "1970-01-01T01:00:01.000Z" },
      { resetsAt: "invalid" },
      { usedPercent: 100.01 },
      { usedPercent: -1 },
      { usedPercent: NaN },
      { kind: "weekly" as const },
      { kind: "monthly" as const },
    ]) {
      expect(UsageResetReminders.dueUsageResetReminders([withWindow(patch)], 0)).toEqual([]);
    }
  });
  it("does not notify from stale or failed probes", () => {
    expect(UsageResetReminders.dueUsageResetReminders([provider], 600_001)).toEqual([]);
    expect(
      UsageResetReminders.dueUsageResetReminders(
        [
          {
            ...provider,
            usageLimits: { ...provider.usageLimits!, unavailable: { reason: "probeFailed" } },
          },
        ],
        0,
      ),
    ).toEqual([]);
  });

  it.effect("sends once, persists across construction, and respects disabling", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response('{"delivered":true}', { headers: { "content-type": "application/json" } }),
        );
      let enabled = true;
      const dependencies = Layer.mergeAll(
        Layer.mock(Settings.ServerSettingsService, {
          getSettings: Effect.sync(() => ({
            ...DEFAULT_SERVER_SETTINGS,
            usageResetRemindersEnabled: enabled,
          })),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry, {
          getProviders: Effect.succeed([withWindow({ usedPercent: 90 })]),
          refreshInstance: () => Effect.succeed([withWindow({ usedPercent: 90 })]),
        }),
        Layer.mock(ServerSecretStore.ServerSecretStore, {
          get: (name) =>
            Effect.succeed(
              Option.some(
                new TextEncoder().encode(
                  name === RELAY_URL_SECRET ? "https://relay.test" : "test-credential",
                ),
              ),
            ),
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment, {
          getEnvironmentId: Effect.succeed(EnvironmentId.make("test-environment")),
        }),
        ServerConfig.layerTest(process.cwd(), home),
      );
      const layer = UsageResetReminders.layer.pipe(Layer.provide(dependencies));
      const sweep = Effect.gen(function* () {
        const service = yield* UsageResetReminders.UsageResetReminders;
        yield* service.sweep;
        yield* service.sweep;
      });
      yield* sweep.pipe(Effect.provide(layer));
      expect(fetch).toHaveBeenCalledTimes(1);
      yield* TestClock.adjust("1 minute");
      yield* sweep.pipe(Effect.provide(layer));
      expect(fetch).toHaveBeenCalledTimes(1);
      enabled = false;
      yield* sweep.pipe(Effect.provide(layer));
      expect(fetch).toHaveBeenCalledTimes(1);
      const config = yield* ServerConfig.ServerConfig.pipe(
        Effect.provide(ServerConfig.layerTest(process.cwd(), home)),
      );
      const ledger = yield* fs
        .readFileString(`${config.stateDir}/usage-reset-reminders.json`)
        .pipe(
          Effect.flatMap(
            Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number))),
          ),
        );
      expect(Object.values(ledger)).toEqual([3_600_000]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
