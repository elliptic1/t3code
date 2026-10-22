import AsyncStorage from "@react-native-async-storage/async-storage";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";
import { serverEnvironment } from "../../state/server";
import {
  awaitAndroidRunningUsageStopped,
  supportsAndroidRunningUsage,
  updateAndroidRunningUsage,
} from "../agent-awareness/androidNotifications";
import {
  restoreRunningUsageHistory,
  runningUsageNotification,
  sampleRunningUsage,
  type RunningUsageHistory,
} from "./runningUsage";
import { runningThreadUsageReadings } from "./runningUsageSnapshot";

const STORAGE_KEY = "t3code.running-usage-history.v1";
const INTERVAL = 60_000;
const snapshotAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const presentations = get(environmentPresentations.presentationsWithProvidersAtom);
  const configurations = new Map<EnvironmentId, ServerConfig>();
  const connected = new Set<EnvironmentId>();
  const live: EnvironmentId[] = [];
  let ready = catalog.isReady;
  for (const [id, presentation] of presentations) {
    if (presentation.serverConfig) configurations.set(id, presentation.serverConfig);
    if (presentation.connection.phase === "connected") connected.add(id);
    const isLive =
      presentation.connection.phase === "connected" &&
      get(environmentShell.stateValueAtom(id)).status === "live";
    if (isLive) live.push(id);
    ready &&= isLive;
  }
  return {
    ...runningThreadUsageReadings(
      get(environmentThreadShells.quietThreadShellsAtom),
      configurations,
      connected,
    ),
    ready,
    connected: [...connected],
    live,
  };
}).pipe(Atom.withEquality((a, b) => JSON.stringify(a) === JSON.stringify(b)));

let monitor: { owners: number; dispose: () => void } | null = null;

/** Shared by the mounted UI and the foreground service's headless task. */
export function retainRunningUsageMonitor(): () => void {
  if (!supportsAndroidRunningUsage()) return () => {};
  if (monitor) {
    monitor.owners += 1;
    return release;
  }
  let history: RunningUsageHistory = {};
  let loaded = false;
  let active = false;
  let disposed = false;
  let permissionAttempted = false;
  let requestingPermission = false;
  let lastPersisted = 0;
  let lastPayload = "";
  const pendingRefresh = new Set<string>();
  const refreshAt = new Map<string, number>();
  const observedActiveEnvironments = new Set<EnvironmentId>();
  let storageWrite = Promise.resolve();

  const requestPermission = async () => {
    if (AppState.currentState !== "active" || permissionAttempted || requestingPermission) return;
    requestingPermission = true;
    try {
      const existing = await Notifications.getPermissionsAsync();
      permissionAttempted = true;
      if (!existing.granted && existing.canAskAgain) await Notifications.requestPermissionsAsync();
    } catch {
      /* A disabled channel stays under the user's control in Android Settings. */
    } finally {
      requestingPermission = false;
    }
  };

  const update = () => {
    if (disposed || !loaded) return;
    const snapshot = appAtomRegistry.get(snapshotAtom);
    const now = Date.now();
    for (const id of snapshot.live) {
      if (!snapshot.environmentIds.includes(id)) observedActiveEnvironments.delete(id);
    }
    for (const id of snapshot.environmentIds) observedActiveEnvironments.add(id);
    if (snapshot.activeCount === 0) {
      if (snapshot.ready || (active && observedActiveEnvironments.size === 0)) {
        updateAndroidRunningUsage(null);
        if (active || Object.keys(history).length > 0) {
          storageWrite = storageWrite
            .then(() => AsyncStorage.removeItem(STORAGE_KEY))
            .catch(() => {});
        }
        active = false;
        lastPayload = "";
        history = {};
      }
      return;
    }
    active = true;
    void requestPermission().then(() => {
      // A completion arriving during the permission prompt must not resurrect the card.
      if (!disposed && appAtomRegistry.get(snapshotAtom).activeCount > 0) publish();
    });
    history = sampleRunningUsage(history, snapshot.readings, now);
    publish();
    if (now - lastPersisted >= INTERVAL) {
      lastPersisted = now;
      const encodedHistory = JSON.stringify(history);
      storageWrite = storageWrite
        .then(() => AsyncStorage.setItem(STORAGE_KEY, encodedHistory))
        .catch(() => {});
    }
    for (const { environmentId, instanceId } of snapshot.refreshTargets) {
      const key = `${environmentId}:${instanceId}`;
      if (
        !snapshot.connected.includes(environmentId) ||
        pendingRefresh.has(key) ||
        now - (refreshAt.get(key) ?? 0) < INTERVAL
      )
        continue;
      pendingRefresh.add(key);
      refreshAt.set(key, now);
      void runAtomCommand(
        appAtomRegistry,
        serverEnvironment.refreshProviders,
        { environmentId, input: { instanceId, fresh: true, refreshModels: false } },
        { reportFailure: false, reportDefect: false },
      ).finally(() => pendingRefresh.delete(key));
    }
  };
  const publish = () => {
    if (disposed || !active) return;
    const snapshot = appAtomRegistry.get(snapshotAtom);
    if (snapshot.activeCount === 0) return;
    const payload = runningUsageNotification(
      snapshot.activeCount,
      snapshot.readings,
      history,
      Date.now(),
    );
    const encoded = JSON.stringify({ ...payload, updatedAt: 0 });
    // Still heartbeat every minute so native code can detect a suspended bridge.
    if (encoded !== lastPayload) {
      if (updateAndroidRunningUsage(payload)) lastPayload = encoded;
    }
  };
  const unsubscribe = appAtomRegistry.subscribe(snapshotAtom, update);
  const timer = setInterval(() => {
    lastPayload = "";
    update();
  }, INTERVAL);
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      lastPayload = "";
      update();
    }
  });
  monitor = {
    owners: 1,
    dispose: () => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
      subscription.remove();
    },
  };
  void AsyncStorage.getItem(STORAGE_KEY)
    .then((value) => {
      history = restoreRunningUsageHistory(value);
    })
    .catch(() => {})
    .finally(() => {
      loaded = true;
      update();
    });
  return release;
}

function release() {
  if (monitor && --monitor.owners === 0) {
    monitor.dispose();
    monitor = null;
  }
}

const holdConnection = createRuntimeCommand(connectionAtomRuntime, {
  label: "running thread usage monitoring",
  execute: Effect.fn("RunningUsage.holdConnection")(function* () {
    yield* EnvironmentRegistry.EnvironmentRegistry;
    yield* Effect.promise(awaitAndroidRunningUsageStopped);
  }),
});

export async function keepRunningUsageConnected() {
  // A push may have launched a cold runtime; restore the existing relay login too.
  const { restorePhoneCloudSession } = await import("../../rpc/watch-companion");
  await restorePhoneCloudSession().catch(() => {});
  const dispose = retainRunningUsageMonitor();
  try {
    await runAtomCommand(appAtomRegistry, holdConnection, undefined, {
      reportFailure: false,
      reportDefect: false,
    });
  } finally {
    dispose();
  }
}
