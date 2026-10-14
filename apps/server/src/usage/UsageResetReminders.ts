import type { ServerProvider } from "@t3tools/contracts";
import type { RelayUsageResetReminder } from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { RELAY_ENVIRONMENT_CREDENTIAL_SECRET, RELAY_URL_SECRET } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { makeRelayEnvironmentClient } from "../relay/relayEnvironmentClient.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as Settings from "../serverSettings.ts";

/** Only fresh, short subscription windows with a known future reset qualify. */
export function dueUsageResetReminders(providers: readonly ServerProvider[], nowMs: number) {
  return providers.flatMap((provider) => {
    const limits = provider.usageLimits;
    const checkedMs = Date.parse(limits?.checkedAt ?? "");
    if (
      !provider.enabled ||
      !provider.installed ||
      !limits ||
      limits.unavailable ||
      !Number.isFinite(checkedMs) ||
      checkedMs > nowMs ||
      nowMs - checkedMs > 10 * 60_000
    )
      return [];
    return limits.windows.flatMap((window): RelayUsageResetReminder[] => {
      const resetMs = Date.parse(window.resetsAt ?? "");
      if (
        window.kind !== "session" ||
        !Number.isFinite(resetMs) ||
        resetMs <= nowMs ||
        resetMs - nowMs > 60 * 60_000 ||
        !Number.isFinite(window.usedPercent) ||
        window.usedPercent > 100 ||
        window.usedPercent < 0
      )
        return [];
      return [
        {
          providerInstanceId: provider.instanceId,
          providerLabel: (provider.displayName ?? provider.driver).slice(0, 120),
          windowId: window.id,
          resetsAt: DateTime.formatIso(DateTime.makeUnsafe(resetMs)),
          remainingPercent: 100 - window.usedPercent,
        },
      ];
    });
  });
}

const Ledger = Schema.Record(Schema.String, Schema.Number);
const decodeLedger = Schema.decodeUnknownEffect(Schema.fromJsonString(Ledger));
const encodeIdentity = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeLedger = Schema.encodeSync(Schema.fromJsonString(Ledger));

export class UsageResetReminders extends Context.Service<
  UsageResetReminders,
  {
    readonly sweep: Effect.Effect<void>;
  }
>()("t3/usage/UsageResetReminders") {}

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  const ledgerPath = path.join(config.stateDir, "usage-reset-reminders.json");
  let nextSweepAt = 0;
  const readSecret = (name: string) =>
    secrets
      .get(name)
      .pipe(Effect.map((value) => Option.map(value, (bytes) => new TextDecoder().decode(bytes))));
  const sweep = Effect.gen(function* () {
    if (!(yield* settings.getSettings).usageResetRemindersEnabled) return;
    const nowMs = (yield* DateTime.now).epochMilliseconds;
    if (nowMs < nextSweepAt) return;
    nextSweepAt = nowMs + 60_000;
    const url = yield* readSecret(RELAY_URL_SECRET);
    const credential = yield* readSecret(RELAY_ENVIRONMENT_CREDENTIAL_SECRET);
    if (Option.isNone(url) || Option.isNone(credential)) return;
    const snapshot = yield* providers.getProviders;
    // Opting in keeps quota fresh even when no client is connected. Refresh
    // only instances that report short windows, plus Claude/Codex at startup.
    yield* Effect.forEach(
      snapshot.filter(
        (provider) =>
          provider.enabled &&
          provider.installed &&
          (provider.usageLimits?.windows.some((window) => window.kind === "session") ||
            provider.driver === "claudeAgent" ||
            provider.driver === "codex"),
      ),
      (provider) => providers.refreshInstance(provider.instanceId),
      { concurrency: 2, discard: true },
    );
    const now = (yield* DateTime.now).epochMilliseconds;
    const due = dueUsageResetReminders(yield* providers.getProviders, now);
    if (due.length === 0) return;
    const ledger = (yield* fs.exists(ledgerPath))
      ? yield* fs.readFileString(ledgerPath).pipe(Effect.flatMap(decodeLedger))
      : {};
    const currentLedger = Object.fromEntries(
      Object.entries(ledger).filter(([, resetMs]) => resetMs > now),
    );
    const client = yield* makeRelayEnvironmentClient({
      url: url.value,
      environmentCredential: credential.value,
    });
    const environmentId = yield* environment.getEnvironmentId;
    for (const reminder of due) {
      const identity = encodeIdentity([
        reminder.providerInstanceId,
        reminder.windowId,
        reminder.resetsAt,
      ]);
      if (currentLedger[identity] !== undefined) continue;
      const response = yield* client.server
        .publishUsageResetReminder({
          params: { environmentId },
          payload: reminder,
        })
        .pipe(Effect.timeout("15 seconds"));
      if (!response.delivered) continue;
      currentLedger[identity] = Date.parse(reminder.resetsAt);
      yield* fs.makeDirectory(config.stateDir, { recursive: true });
      const temporary = `${ledgerPath}.tmp`;
      yield* fs.writeFileString(temporary, encodeLedger(currentLedger));
      yield* fs.rename(temporary, ledgerPath);
    }
  }).pipe(lock.withPermits(1), Effect.ignoreCause({ log: true }));
  return UsageResetReminders.of({ sweep });
});

export const layer = Layer.effect(UsageResetReminders, make);
export const layerWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const reminders = yield* UsageResetReminders;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("usage-reset-reminders", reminders.sweep);
  }),
).pipe(Layer.provideMerge(layer));
