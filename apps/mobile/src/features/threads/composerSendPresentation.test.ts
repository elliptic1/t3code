import { describe, expect, it } from "vite-plus/test";

import { resolveComposerSendPresentation } from "./composerSendPresentation";

const idle = {
  editingQueuedMessage: false,
  running: false,
  canSteer: false,
  followUpBehavior: "queue",
  deliveryDeferred: false,
} as const;

describe("resolveComposerSendPresentation", () => {
  it("never promises steering the provider cannot do", () => {
    const presentation = resolveComposerSendPresentation({
      ...idle,
      running: true,
      canSteer: false,
      followUpBehavior: "steer",
    });

    expect(presentation.label).toBe("Queue");
    expect(presentation.action).toBe("queue");
    expect(presentation.alternate).toBeNull();
    expect(presentation.offersFollowUpChoice).toBe(false);
  });

  it("offers parallel work even when steering is unsupported", () => {
    const presentation = resolveComposerSendPresentation({
      ...idle,
      running: true,
      canParallel: true,
    });
    expect(presentation.action).toBe("queue");
    expect(presentation.choices).toEqual(["queue", "parallel"]);
    expect(presentation.offersFollowUpChoice).toBe(true);
  });

  it("offers all three actions while a steerable turn runs", () => {
    expect(
      resolveComposerSendPresentation({ ...idle, running: true, canSteer: true, canParallel: true })
        .choices,
    ).toEqual(["queue", "steer", "parallel"]);
    expect(
      resolveComposerSendPresentation({ ...idle, canSteer: true, canParallel: true }).choices,
    ).toEqual([]);
    expect(
      resolveComposerSendPresentation({
        ...idle,
        running: true,
        canSteer: true,
        canParallel: true,
        editingQueuedMessage: true,
      }).choices,
    ).toEqual([]);
  });

  it("keeps the save affordance while a queued message is being edited", () => {
    const presentation = resolveComposerSendPresentation({
      ...idle,
      editingQueuedMessage: true,
      running: true,
      canSteer: true,
      followUpBehavior: "steer",
    });

    expect(presentation.label).toBe("Update queued message");
    expect(presentation.icon).toBe("checkmark");
    expect(presentation.offersFollowUpChoice).toBe(false);
  });
});
