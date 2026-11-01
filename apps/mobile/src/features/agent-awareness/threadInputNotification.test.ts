import { describe, expect, it } from "vite-plus/test";
import type {
  PendingThreadRequests,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import { EnvironmentId, ThreadId, RuntimeRequestId } from "@t3tools/contracts";
import { threadInputNotifications, threadInputResponse } from "./threadInputNotification";

const thread = {
  environmentId: EnvironmentId.make("env-a"),
  id: ThreadId.make("thread-a"),
  title: "My thread",
};
const requestId = RuntimeRequestId.make("request-a");
const question = {
  id: "q1",
  header: "Choice",
  question: "What should I do?",
  multiSelect: false,
  options: [
    { label: "First", value: "one", description: "First choice" },
    { label: "Second", value: "two", description: "Second choice" },
  ],
};
function pending(overrides: Partial<ThreadPendingUserInput> = {}): PendingThreadRequests {
  return {
    approvals: [],
    userInputs: [
      {
        requestId,
        createdAt: "2026-10-23T00:00:00Z",
        questions: [question],
        responseCapability: "live",
        dismissible: false,
        ...overrides,
      },
    ],
  };
}

describe("thread input notifications", () => {
  it("offers choice values and text reply for a complete single question", () => {
    const [card] = threadInputNotifications(thread, pending());
    expect(card?.allowReply).toBe(true);
    expect(card?.actions.map((action) => action.id)).toEqual(["choice:one", "choice:two"]);
    expect(threadInputResponse(pending(), requestId, "choice:two", "")).toEqual({
      kind: "answer",
      answers: { q1: "two" },
    });
    expect(threadInputResponse(pending(), requestId, "reply", "  Please continue  ")).toEqual({
      kind: "answer",
      answers: { q1: "Please continue" },
    });
  });
  it("never converts a blank reply or a removed choice into an answer", () => {
    expect(threadInputResponse(pending(), requestId, "reply", " \n ")).toBeNull();
    expect(threadInputResponse(pending(), requestId, "choice:old", "")).toBeNull();
    expect(
      threadInputResponse(pending(), RuntimeRequestId.make("old-request"), "reply", "yes"),
    ).toBeNull();
  });
  it("opens complex questions in the thread instead of partially submitting them", () => {
    for (const requests of [
      pending({ questions: [question, { ...question, id: "q2" }] }),
      pending({ questions: [{ ...question, multiSelect: true }] }),
    ]) {
      expect(threadInputNotifications(thread, requests)[0]).toMatchObject({
        actions: [],
        allowReply: false,
      });
      expect(threadInputResponse(requests, requestId, "reply", "yes")).toBeNull();
    }
  });
  it("does not permit free text when the provider requires a fixed choice", () => {
    const requests = pending({ questions: [{ ...question, allowCustomAnswer: false }] });
    expect(threadInputNotifications(thread, requests)[0]?.allowReply).toBe(false);
    expect(threadInputResponse(requests, requestId, "reply", "other")).toBeNull();
    expect(threadInputResponse(requests, requestId, "choice:one", "")).not.toBeNull();
  });
  it("keeps non-resumable requests visible without executable actions", () => {
    const requests = pending({ responseCapability: "not_resumable" });
    expect(threadInputNotifications(thread, requests)[0]).toMatchObject({
      actions: [],
      allowReply: false,
    });
    expect(threadInputResponse(requests, requestId, "choice:one", "")).toBeNull();
  });
  it("offers only one-time approval and decline, respecting provider warnings", () => {
    const requests: PendingThreadRequests = {
      userInputs: [],
      approvals: [
        {
          requestId,
          createdAt: "2026-10-23T00:00:00Z",
          requestKind: "command",
          responseCapability: "live",
          options: [
            { decision: "accept", label: "Approve once" },
            { decision: "acceptAlways", label: "Always" },
            { decision: "decline", label: "Decline" },
          ],
        },
      ],
    };
    expect(
      threadInputNotifications(thread, requests)[0]?.actions.map((action) => action.id),
    ).toEqual(["accept", "decline"]);
    expect(threadInputResponse(requests, requestId, "accept", "")).toEqual({
      kind: "approval",
      decision: "accept",
    });
    expect(threadInputResponse(requests, requestId, "acceptAlways", "")).toBeNull();
    const warned = {
      ...requests,
      approvals: requests.approvals.map((request) => ({
        ...request,
        options: [{ decision: "accept" as const, label: "Approve", warning: "Review details" }],
      })),
    };
    expect(threadInputNotifications(thread, warned)[0]?.actions).toEqual([]);
    expect(threadInputResponse(warned, requestId, "accept", "")).toBeNull();
  });
  it("scopes notifications independently across environments and threads", () => {
    const first = threadInputNotifications(thread, pending())[0]!;
    const second = threadInputNotifications(
      { ...thread, environmentId: EnvironmentId.make("env-b") },
      pending(),
    )[0]!;
    expect(first.key).not.toBe(second.key);
  });
});
