import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request, subscribe } from "@t3tools/client-runtime/rpc";
import {
  CLIENT_LOG_MAX_LENGTH,
  type ClientLogRequest,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

import * as MobileStorage from "../persistence/mobile-storage";

// Reading 20,000 lines and sending them over cellular can take a while; a stuck answer must not
// hold up the next request.
const ANSWER_TIMEOUT = "45 seconds";

class AppLogReadError extends Schema.TaggedError<AppLogReadError>()("AppLogReadError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Could not read this app's logcat.";
  }
}

type ReadAppLogs = (maxLines: number) => Promise<string>;

// Imported lazily: loading `expo` at module scope breaks Node tests that import the runtime.
const loadReadAppLogs = Effect.promise(async (): Promise<ReadAppLogs | undefined> => {
  if (Platform.OS !== "android") return undefined;
  const native = (await import("expo")).requireOptionalNativeModule<{
    readonly readAppLogs?: ReadAppLogs;
  }>("T3NativeControls");
  return native?.readAppLogs?.bind(native);
});

/** Answers an environment's requests for this app's logs, so agents never need adb. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    // iOS and builds without the native reader never listen, so the server falls back at once.
    const readAppLogs = yield* loadReadAppLogs;
    if (readAppLogs === undefined) return;
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const storage = yield* MobileStorage.MobileStorage;
    // The id background activity reports, so one phone keeps one log folder on the server.
    const clientId = yield* storage.loadOrCreateAgentAwarenessDeviceId.pipe(
      Effect.map((deviceId) => `mobile-${deviceId}`),
      Effect.orElseSucceed(() => "ephemeral-mobile-client"),
    );
    const clientLabel = Device.modelName?.trim();
    const appVersion = `${Constants.expoConfig?.version ?? "0.0.0"} (${Application.nativeBuildVersion ?? "dev"})`;

    const answer = (environmentId: EnvironmentId, logRequest: ClientLogRequest) =>
      Effect.tryPromise({
        try: () => readAppLogs(logRequest.maxLines),
        catch: (cause) => new AppLogReadError({ cause }),
      }).pipe(
        Effect.flatMap((log) =>
          registry.run(
            environmentId,
            request(WS_METHODS.serverUploadClientLogs, {
              requestId: logRequest.requestId,
              clientId,
              ...(clientLabel ? { clientLabel } : {}),
              platform: "android",
              appVersion,
              log: log.slice(-CLIENT_LOG_MAX_LENGTH),
            }),
          ),
        ),
        Effect.timeout(ANSWER_TIMEOUT),
        // Not `ignore`: an interrupt from a torn-down environment must not end the listener.
        Effect.catchCause((cause) =>
          Effect.logWarning("[client-logs] could not answer a log request", Cause.pretty(cause)),
        ),
        Effect.withSpan("mobile.clientLogs.answer"),
      );

    const listen = (environmentId: EnvironmentId) =>
      registry
        .followStream(
          environmentId,
          subscribe(
            WS_METHODS.subscribeClientLogRequests,
            { clientId },
            {
              // An older server or a session without operate access: wait for the next session.
              onExpectedFailure: (cause) =>
                Effect.logInfo("[client-logs] not listening on this session", Cause.pretty(cause)),
              onDefect: (cause) =>
                Effect.logWarning("[client-logs] log request stream failed", Cause.pretty(cause)),
            },
          ),
        )
        .pipe(
          Stream.runForEach((logRequest) => answer(environmentId, logRequest)),
          Effect.catchCause((cause) =>
            Effect.logWarning("[client-logs] stopped listening", Cause.pretty(cause)),
          ),
        );

    const listeners = new Map<EnvironmentId, Fiber.Fiber<void>>();
    yield* Stream.concat(
      Stream.fromEffect(SubscriptionRef.get(registry.entries)),
      SubscriptionRef.changes(registry.entries),
    ).pipe(
      Stream.runForEach((entries) =>
        Effect.gen(function* () {
          for (const [environmentId, fiber] of listeners) {
            if (entries.has(environmentId)) continue;
            listeners.delete(environmentId);
            yield* Fiber.interrupt(fiber);
          }
          for (const environmentId of entries.keys()) {
            if (listeners.has(environmentId)) continue;
            listeners.set(environmentId, yield* Effect.forkScoped(listen(environmentId)));
          }
        }),
      ),
      Effect.forkScoped,
    );
  }),
);
