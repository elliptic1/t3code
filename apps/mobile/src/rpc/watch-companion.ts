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
  followStreamInEnvironment,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
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
import { makeTurnCommandMetadata } from "../lib/commandMetadata";
import { activateCloudRelayAccount } from "../features/cloud/CloudAuthProvider";
import {
  resolveCloudPublicConfig,
  resolveRelayClerkTokenOptions,
} from "../features/cloud/publicConfig";

const bridge = () =>
  requireNativeModule<{ respond: (nodeId: string, response: string) => Promise<void> }>(
    "T3WearDataLayer",
  );
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(WatchCompanionRequest));

const decodeDispatchCommand = Schema.decodeUnknownEffect(
  OrchestrationV2RpcSchemas.dispatchCommand.input,
);

const preparedConnection = Effect.gen(function* () {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
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

const requestCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "watch companion request",
  execute: (request: WatchCompanionRequest) =>
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const entries = yield* SubscriptionRef.get(registry.entries);
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
      yield* onEnvironment(
        request.environmentId,
        requestGuarded(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, command),
      );
      return { accepted: true };
    }).pipe(Effect.timeout("50 seconds")),
});

async function restorePhoneCloudSession() {
  const publishableKey = resolveCloudPublicConfig().clerk.publishableKey;
  if (!publishableKey) return;
  const clerk = getClerkInstance({ publishableKey, tokenCache });
  if (!clerk.loaded) await clerk.load();
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
    const result = await runAtomCommand(appAtomRegistry, requestCommand, request, {
      reportFailure: false,
      reportDefect: false,
    });
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
