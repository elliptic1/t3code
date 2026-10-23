import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, ThreadId, RuntimeRequestId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { completeAndroidThreadInputResponse } from "./androidNotifications";
import { threadInputResponse } from "./threadInputNotification";

const Response = Schema.Struct({
  key: Schema.String,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: RuntimeRequestId,
  action: Schema.String,
  text: Schema.String,
});
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Response));

const respond = createRuntimeCommand(connectionAtomRuntime, {
  label: "notification:thread-input-response",
  execute: Effect.fn("Notification.respondToThreadInput")(
    function* (input: typeof Response.Type) {
      yield* EnvironmentRegistry.EnvironmentRegistry;
      const ref = { environmentId: input.environmentId, threadId: input.threadId };
      const status = environmentThreadDetails.statusAtom(ref);
      const pending = environmentThreadDetails.pendingRequestsAtom(ref);
      yield* Effect.acquireRelease(
        Effect.sync(() => [appAtomRegistry.mount(status), appAtomRegistry.mount(pending)]),
        (releases) => Effect.sync(() => releases.forEach((release) => release())),
      );
      // Cached requests are never actionable. Wait for this environment's live state.
      yield* Effect.callback<void>((resume) => {
        const check = () => {
          const value = appAtomRegistry.get(status);
          if (value === "deleted" || (value === "live" && appAtomRegistry.get(pending) !== null))
            resume(Effect.void);
        };
        const releases = [
          appAtomRegistry.subscribe(status, check),
          appAtomRegistry.subscribe(pending, check),
        ];
        check();
        return Effect.sync(() => releases.forEach((release) => release()));
      }).pipe(Effect.timeout("25 seconds"));
      const requests = appAtomRegistry.get(pending);
      if (
        !requests ||
        ![...requests.approvals, ...requests.userInputs].some(
          (request) => request.requestId === input.requestId,
        )
      )
        return;
      const response = threadInputResponse(requests, input.requestId, input.action, input.text);
      if (!response)
        return yield* Effect.fail(
          new Error("This request needs to be answered inside the thread."),
        );
      const result = yield* Effect.promise(() =>
        response.kind === "approval"
          ? runAtomCommand(
              appAtomRegistry,
              threadEnvironment.respondToApproval,
              {
                environmentId: input.environmentId,
                input: {
                  threadId: input.threadId,
                  requestId: input.requestId,
                  decision: response.decision,
                },
              },
              { reportFailure: false, reportDefect: false },
            )
          : runAtomCommand(
              appAtomRegistry,
              threadEnvironment.respondToUserInput,
              {
                environmentId: input.environmentId,
                input: {
                  threadId: input.threadId,
                  requestId: input.requestId,
                  answers: response.answers,
                },
              },
              { reportFailure: false, reportDefect: false },
            ),
      );
      if (result._tag !== "Success")
        return yield* Effect.fail(new Error("The thread did not accept the response."));
    },
    Effect.scoped,
    Effect.timeout("45 seconds"),
  ),
});

export async function handleThreadInputResponse(input: { payload: string }): Promise<void> {
  const response = decode(input.payload);
  try {
    const { restorePhoneCloudSession } = await import("../../rpc/watch-companion");
    await restorePhoneCloudSession().catch(() => {});
    const result = await runAtomCommand(appAtomRegistry, respond, response, {
      reportFailure: false,
      reportDefect: false,
    });
    completeAndroidThreadInputResponse(response.key, result._tag === "Success");
  } catch {
    completeAndroidThreadInputResponse(response.key, false);
  }
}
