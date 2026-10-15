import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import * as DateTime from "effect/DateTime";

type FallbackHistory = Pick<OrchestrationV2ThreadProjection, "thread" | "runs" | "turnItems">;

/** Provider accounts share allowances. Unknown or stale reset reports get a bounded cooldown. */
export function resolveModelFallback(
  projection: FallbackHistory,
  nowMs: number,
): ModelSelection | null {
  const policy = projection.thread.modelFallback;
  if (!policy) return null;
  const limited = (selection: ModelSelection) => {
    const latest = latestExecutedRun(
      projection.runs.filter(
        (run) =>
          run.providerInstanceId === selection.instanceId &&
          (run.status === "failed" || run.status === "completed"),
      ),
    );
    const failure = latestRootProviderFailure(latest, projection.turnItems);
    if (failure?.class !== "usage_limit") return false;
    const failedAt = DateTime.toEpochMillis(latest?.completedAt ?? projection.thread.updatedAt);
    const reported = failure.resetAt == null ? NaN : Date.parse(failure.resetAt);
    const resetAt =
      Number.isFinite(reported) && reported > failedAt ? reported : failedAt + 15 * 60_000;
    return resetAt > nowMs;
  };
  return !limited(policy.preferred)
    ? policy.preferred
    : !limited(policy.fallback)
      ? policy.fallback
      : null;
}

/** Stable identity and serialized dispatch make scheduler retries safe across restarts. */
export function modelFallbackContinuation(
  projection: FallbackHistory & Pick<OrchestrationV2ThreadProjection, "runtimeRequests">,
  nowMs: number,
): Extract<OrchestrationV2Command, { type: "message.dispatch" }> | null {
  const source = latestExecutedRun(projection.runs);
  if (
    !projection.thread.modelFallback ||
    source?.status !== "failed" ||
    projection.turnItems.some(
      (item) => item.runId === source.id && item.type === "run_interrupt_request",
    ) ||
    latestRootProviderFailure(source, projection.turnItems)?.class !== "usage_limit" ||
    projection.thread.archivedAt !== null ||
    projection.thread.deletedAt !== null ||
    projection.thread.settledOverride === "settled" ||
    (projection.thread.snoozedUntil != null &&
      DateTime.toEpochMillis(projection.thread.snoozedUntil) > nowMs) ||
    projection.runtimeRequests.some((request) => request.status === "pending")
  )
    return null;
  const selection = resolveModelFallback(projection, nowMs);
  if (!selection) return null;
  const identity = `model-fallback:${projection.thread.id}:${source.id}:${selection.instanceId}:${selection.model}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(identity),
    messageId: MessageId.make(identity),
    threadId: projection.thread.id,
    modelSelection: selection,
    modelFallbackContinuationOfRunId: source.id,
    text: "Continue where the previous turn stopped. Complete the user's last request using the transferred conversation context.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "server",
  };
}
