import { voiceSessionConfiguration } from "@t3tools/client-runtime/voice-conversation/session";
import { createVoiceToolRunner } from "@t3tools/client-runtime/voice-conversation";
import {
  createVoiceActions,
  createVoiceSessionCommand,
  syncVoiceHistoryCommand,
  voiceResult,
} from "../features/voice-conversation/actions";
import { getClerkInstance } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { requireNativeModule } from "expo";
import { EnvironmentSupervisor, EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { RemoteEnvironmentAuthorization } from "@t3tools/client-runtime/authorization";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { requestGuarded } from "@t3tools/client-runtime/rpc";
import { ShellSnapshotLoader } from "@t3tools/client-runtime/state/shell";
import {
  BoundedThreadSnapshotLoader,
  ThreadHistoryHttp,
} from "@t3tools/client-runtime/state/threads";
import {
  createRuntimeCommand,
  createEnvironmentRpcCommand,
  type AtomCommand,
  followStreamInEnvironment,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  WS_METHODS,
  WatchCompanionRequest,
  OrchestrationV2RpcSchemas,
  ORCHESTRATION_V2_WS_METHODS,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../state/atom-registry";
import { environmentShell } from "../state/shell";
import { serverEnvironment } from "../state/server";
import { makeTurnCommandMetadata } from "../lib/commandMetadata";
import { activateCloudRelayAccount } from "../features/cloud/CloudAuthProvider";
import {
  resolveCloudPublicConfig,
  resolveRelayClerkTokenOptions,
} from "../features/cloud/publicConfig";

const bridge = () =>
  requireNativeModule<{
    respond: (nodeId: string, response: string) => Promise<void>;
    setConnectionReady: (enabled: boolean) => Promise<void>;
    startVoiceRelay: (
      nodeId: string,
      sessionId: string,
      connection: string,
      configuration: string,
    ) => Promise<void>;
  }>("T3WearDataLayer");
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(WatchCompanionRequest));

const decodeDispatchCommand = Schema.decodeUnknownEffect(
  OrchestrationV2RpcSchemas.dispatchCommand.input,
);

const preparedConnection = Effect.gen(function* () {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  if (Option.isNone(yield* SubscriptionRef.get(supervisor.prepared))) yield* supervisor.retryNow;
  const prepared = yield* SubscriptionRef.changes(supervisor.prepared).pipe(
    Stream.filter(Option.isSome),
    Stream.map((value) => value.value),
    Stream.runHead,
  );
  return yield* Effect.fromOption(prepared, () => new Error("Phone connection is unavailable."));
});

function onEnvironment<A, E, R>(environmentId: EnvironmentId, effect: Effect.Effect<A, E, R>) {
  return followStreamInEnvironment(environmentId, Stream.fromEffect(effect)).pipe(
    Stream.runHead,
    Effect.flatMap((value) =>
      Effect.fromOption(value, () => new Error("Phone connection is unavailable.")),
    ),
  );
}

const loadShell = Effect.gen(function* () {
  const prepared = yield* preparedConnection;
  const loader = yield* ShellSnapshotLoader.ShellSnapshotLoader;
  const snapshot = yield* loader.load(prepared);
  return yield* Effect.fromOption(snapshot, () => new Error("Could not load the phone's threads."));
});

function phoneCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W) {
  return Effect.tryPromise(async () =>
    voiceResult(
      await runAtomCommand(appAtomRegistry, command, input, {
        reportFailure: false,
        reportDefect: false,
      }),
    ),
  );
}

const sendWatchMessage = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "watch:send-message",
  tag: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
});

const requestCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "watch companion request",
  execute: Effect.fn("Watch.handleRequest")(
    function* ({ request, nodeId }: { request: WatchCompanionRequest; nodeId: string }) {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const entries = yield* SubscriptionRef.get(registry.entries);
      if (request.operation === "voiceStart") {
        const candidates = [...entries.values()].filter(
          (entry) =>
            entry.enabled &&
            (!request.environmentId || entry.target.environmentId === request.environmentId),
        );
        for (const entry of candidates) {
          const environmentId = entry.target.environmentId;
          const ready = yield* onEnvironment(environmentId, preparedConnection).pipe(
            Effect.timeout("8 seconds"),
            Effect.option,
          );
          if (Option.isNone(ready)) continue;
          const settings = yield* onEnvironment(
            environmentId,
            requestGuarded(WS_METHODS.serverGetSettings, {}),
          );
          if (!settings.voiceConnection.enabled) continue;
          const history = yield* phoneCommand(syncVoiceHistoryCommand, {
            environmentId,
            input: { lines: [] },
          });
          const connection = yield* phoneCommand(createVoiceSessionCommand, {
            environmentId,
            input: {},
          });
          if (connection.transport !== "websocket")
            return yield* Effect.fail(
              new Error(
                "Choose a WebSocket voice provider in your phone's voice settings for watch conversations.",
              ),
            );
          // A watch can enable the same opted-in presence while the phone stays locked.
          yield* Effect.tryPromise(() => bridge().setConnectionReady(true));
          yield* Effect.tryPromise(() =>
            bridge().startVoiceRelay(
              nodeId,
              request.sessionId,
              JSON.stringify(connection),
              JSON.stringify(voiceSessionConfiguration(connection, history)),
            ),
          );
          return { environmentId, history };
        }
        return yield* Effect.fail(
          new Error("Enable voice conversation for a connected environment on your phone."),
        );
      }
      if (request.operation === "shell") {
        const enabled = [...entries.values()].filter((entry) => entry.enabled);
        const snapshots = yield* Effect.forEach(
          enabled,
          (entry) =>
            onEnvironment(entry.target.environmentId, loadShell).pipe(
              Effect.timeout("20 seconds"),
              Effect.map((snapshot) => ({ entry, snapshot })),
              Effect.option,
            ),
          { concurrency: 2 },
        );
        const available = snapshots.flatMap((snapshot) =>
          Option.isSome(snapshot) ? [snapshot.value] : [],
        );
        if (enabled.length > 0 && available.length === 0)
          return yield* Effect.fail(
            new Error("The phone cannot reach its environments. Check T3 Code on your phone."),
          );
        return {
          projects: available.flatMap(({ entry, snapshot }) =>
            snapshot.projects.map((project) => ({
              id: `${entry.target.environmentId}:${project.id}`,
              title: `${entry.target.label} / ${project.title}`,
            })),
          ),
          threads: available.flatMap(({ entry, snapshot }) =>
            snapshot.threads.map((thread) => ({
              id: thread.id,
              environmentId: entry.target.environmentId,
              title: thread.title,
              projectId: `${entry.target.environmentId}:${thread.projectId}`,
              updatedAt: thread.updatedAt,
              archivedAt: thread.archivedAt,
              status: thread.status,
              activeRunId: thread.activeRunId,
              pendingRuntimeRequestId: thread.pendingRuntimeRequest !== null ? "pending" : null,
            })),
          ),
        };
      }
      if (!entries.get(request.environmentId)?.enabled)
        return yield* Effect.fail(new Error("This environment is not enabled on your phone."));
      if (request.operation === "voiceHistory") {
        const history = yield* phoneCommand(syncVoiceHistoryCommand, {
          environmentId: request.environmentId,
          input: { lines: request.lines },
        });
        return { history };
      }
      if (request.operation === "voiceTool") {
        yield* onEnvironment(request.environmentId, preparedConnection);
        // Headless requests have no mounted screens to hydrate the shared voice actions.
        const shellAtom = environmentShell.stateValueAtom(request.environmentId);
        const configAtom = serverEnvironment.configValueAtom(request.environmentId);
        yield* Effect.acquireRelease(
          Effect.sync(() => [appAtomRegistry.mount(shellAtom), appAtomRegistry.mount(configAtom)]),
          (unmount) => Effect.sync(() => unmount.forEach((dispose) => dispose())),
        );
        yield* Effect.callback<void>((resume) => {
          const check = () => {
            if (appAtomRegistry.get(shellAtom).status === "live" && appAtomRegistry.get(configAtom))
              resume(Effect.void);
          };
          const dispose = [
            appAtomRegistry.subscribe(shellAtom, check),
            appAtomRegistry.subscribe(configAtom, check),
          ];
          check();
          return Effect.sync(() => dispose.forEach((unsubscribe) => unsubscribe()));
        }).pipe(Effect.timeout("15 seconds"));
        // Creating a thread succeeds without navigation; opening an existing one
        // cannot drive an unmounted phone screen from a headless request.
        const actions = createVoiceActions(request.environmentId, async () => {});
        const runTool = createVoiceToolRunner((action) => {
          if (action.action === "open_thread")
            return Promise.reject(
              new Error(
                "Open the thread on your phone or Mac; the watch can read and manage it here.",
              ),
            );
          return actions(action);
        });
        const output = yield* Effect.tryPromise(() =>
          runTool({ call_id: request.callId, name: request.name, arguments: request.arguments }),
        );
        return { output };
      }
      if (request.operation === "thread") {
        return yield* onEnvironment(
          request.environmentId,
          Effect.gen(function* () {
            const prepared = yield* preparedConnection;
            const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
            const authorization = yield* Effect.serviceOption(
              RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
            );
            if (request.cursor)
              return yield* ThreadHistoryHttp.fetchEnvironmentThreadHistoryPage({
                prepared,
                threadId: request.threadId,
                cursor: request.cursor,
                signer,
                remoteAuthorization: authorization,
              });
            return yield* BoundedThreadSnapshotLoader.fetchEnvironmentBoundedThreadSnapshot({
              prepared,
              threadId: request.threadId,
              signer,
              remoteAuthorization: authorization,
            });
          }),
        );
      }
      const metadata = makeTurnCommandMetadata();
      const command = yield* decodeDispatchCommand({
        type: "message.dispatch",
        commandId: metadata.commandId,
        createdBy: "user",
        creationSource: "mobile",
        threadId: request.threadId,
        messageId: metadata.messageId,
        text: request.text,
        attachments: [],
        dispatchMode: { type: request.busy ? "queue_after_active" : "start_immediately" },
      });
      yield* phoneCommand(sendWatchMessage, {
        environmentId: request.environmentId,
        input: command,
      });
      return { accepted: true };
    },
    Effect.scoped,
    Effect.timeout("50 seconds"),
  ),
});

export async function restorePhoneCloudSession() {
  const publishableKey = resolveCloudPublicConfig().clerk.publishableKey;
  if (!publishableKey) return;
  const clerk = getClerkInstance({ publishableKey, tokenCache });
  if (!clerk.loaded) {
    // Cloud sign-in must not hold up a direct LAN or Tailscale pairing while offline.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        clerk.load(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!clerk.loaded) return;
  }
  if (clerk.user && clerk.session) {
    const session = clerk.session;
    activateCloudRelayAccount(clerk.user.id, () =>
      session.getToken(resolveRelayClerkTokenOptions()),
    );
  }
}

/** Uses the phone's existing runtime and auth refresh, including when started by a Wear message. */
export async function handleWatchRequest(input: { nodeId: string; request: string }) {
  let requestId = "";
  try {
    const request = decodeRequest(input.request);
    requestId = request.requestId;
    // Direct pairings remain usable if cloud sign-in cannot be restored offline.
    await restorePhoneCloudSession().catch(() => {});
    const result = await runAtomCommand(
      appAtomRegistry,
      requestCommand,
      { request, nodeId: input.nodeId },
      {
        reportFailure: false,
        reportDefect: false,
      },
    );
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    await bridge().respond(
      input.nodeId,
      JSON.stringify({ requestId, ok: true, body: result.value }),
    );
  } catch (cause) {
    // Authentication stays on the phone. The watch never asks for a separate pairing code.
    await bridge().respond(
      input.nodeId,
      JSON.stringify({
        requestId,
        ok: false,
        error:
          cause instanceof Error ? cause.message : "Check the connection in T3 Code on your phone.",
      }),
    );
  }
}

const presenceCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "background voice connection",
  execute: Effect.fn("Watch.keepConnectionsAlive")(function* () {
    // Construct and retain the same registry, routes and credential stores used by the UI.
    yield* EnvironmentRegistry.EnvironmentRegistry;
    yield* Effect.tryPromise(() =>
      requireNativeModule<{
        awaitConnectionStopped: () => Promise<void>;
      }>("T3WearDataLayer").awaitConnectionStopped(),
    );
  }),
});

export async function keepPhoneConnectionsAlive() {
  await restorePhoneCloudSession().catch(() => {});
  await runAtomCommand(appAtomRegistry, presenceCommand, undefined, {
    reportFailure: false,
    reportDefect: false,
  });
}
