import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type {
  EnvironmentId,
  ThreadId,
  RuntimeRequestId,
  ProviderApprovalDecision,
} from "@t3tools/contracts";

export interface ThreadInputNotification {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly requestId: RuntimeRequestId;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly { readonly id: string; readonly label: string }[];
  readonly allowReply: boolean;
}

type Thread = {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
};

/** Only offer answers that can be submitted completely without opening a form. */
export function threadInputNotifications(
  thread: Thread,
  pending: PendingThreadRequests,
): ThreadInputNotification[] {
  const item = (
    requestId: RuntimeRequestId,
    body: string,
    actions: ThreadInputNotification["actions"],
    allowReply = false,
  ): ThreadInputNotification => ({
    key: JSON.stringify([thread.environmentId, thread.id, requestId]),
    environmentId: thread.environmentId,
    threadId: thread.id,
    requestId,
    title: thread.title || "Thread needs your input",
    body,
    actions,
    allowReply,
  });
  return [
    ...pending.approvals.map((request) =>
      item(
        request.requestId,
        request.detail || request.reason || "Approval needed. Tap to review the request.",
        request.responseCapability !== "live"
          ? []
          : (
              request.options ?? [
                { decision: "accept", label: "Approve once" },
                { decision: "decline", label: "Decline" },
              ]
            )
              .filter(
                (option) =>
                  (option.decision === "accept" || option.decision === "decline") &&
                  !option.warning,
              )
              .map((option) => ({ id: option.decision, label: option.label })),
      ),
    ),
    ...pending.userInputs.map((request) => {
      const question = request.questions.length === 1 ? request.questions[0] : undefined;
      const simple =
        question !== undefined &&
        !question.multiSelect &&
        request.responseCapability !== "not_resumable";
      const allowReply = simple && question.allowCustomAnswer !== false;
      const actions = simple
        ? question.options.slice(0, allowReply ? 2 : 3).map((option) => ({
            id: `choice:${option.value ?? option.label}`,
            label: option.label,
          }))
        : [];
      const body =
        request.questions.map((q) => q.question).join("\n\n") ||
        "Your input is needed. Tap to open the thread.";
      return item(request.requestId, body, actions, allowReply);
    }),
  ];
}

export function threadInputResponse(
  pending: PendingThreadRequests,
  requestId: RuntimeRequestId,
  action: string,
  text: string,
):
  | { readonly kind: "approval"; readonly decision: ProviderApprovalDecision }
  | { readonly kind: "answer"; readonly answers: Record<string, string> }
  | null {
  const approval = pending.approvals.find((request) => request.requestId === requestId);
  if (approval?.responseCapability === "live") {
    const options = approval.options ?? [{ decision: "accept" }, { decision: "decline" }];
    const option = options.find(
      (option) => option.decision === action && !("warning" in option && option.warning),
    );
    if (option && (option.decision === "accept" || option.decision === "decline"))
      return { kind: "approval", decision: option.decision };
  }
  const request = pending.userInputs.find((request) => request.requestId === requestId);
  if (!request || request.responseCapability === "not_resumable" || request.questions.length !== 1)
    return null;
  const question = request.questions[0]!;
  if (question.multiSelect) return null;
  if (action === "reply" && question.allowCustomAnswer !== false && text.trim())
    return { kind: "answer", answers: { [question.id]: text.trim() } };
  const option = question.options.find(
    (option) => action === `choice:${option.value ?? option.label}`,
  );
  return option
    ? { kind: "answer", answers: { [question.id]: option.value ?? option.label } }
    : null;
}
