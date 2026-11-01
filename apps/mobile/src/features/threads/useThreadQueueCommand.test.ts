import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("react-native", () => ({ Alert: { alert: state.alert } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.execute }));

import { useThreadQueueCommand } from "./useThreadQueueCommand";

describe("mobile queue command feedback", () => {
  const command = { label: "promote queued message" } as Parameters<
    typeof useThreadQueueCommand
  >[0];
  const input = {
    environmentId: "remote",
    input: { threadId: "thread", queuedRunId: "queued", targetRunId: "active" },
  };

  beforeEach(() => vi.clearAllMocks());

  it("shows a rejected send instead of silently treating it as successful", async () => {
    const failure = AsyncResult.failure(
      Cause.fail(new Error("The active turn has finished and cannot be steered.")),
    );
    state.execute
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(AsyncResult.success(undefined));
    const send = useThreadQueueCommand(command, "Could not send queued message");

    expect(await send(input)).toBe(failure);
    expect(state.alert).toHaveBeenCalledWith(
      "Could not send queued message",
      "The active turn has finished and cannot be steered.",
    );
    // A failed send remains retryable, using the same destination and queued message.
    expect((await send(input))._tag).toBe("Success");
    expect(state.execute).toHaveBeenNthCalledWith(2, input);
    expect(state.alert).toHaveBeenCalledTimes(1);
  });

  it("reports defects and provides a fallback for failures without a message", async () => {
    state.execute.mockResolvedValueOnce(AsyncResult.failure(Cause.die("disconnected")));
    await useThreadQueueCommand(command, "Could not resume queue")(input);

    expect(state.alert).toHaveBeenCalledWith(
      "Could not resume queue",
      "Please check your connection and try again.",
    );
  });

  it("does not show an error for lifecycle cancellation", async () => {
    state.execute.mockResolvedValueOnce(AsyncResult.failure(Cause.interrupt()));
    await useThreadQueueCommand(command, "Could not send queued message")(input);
    expect(state.alert).not.toHaveBeenCalled();
  });
});
