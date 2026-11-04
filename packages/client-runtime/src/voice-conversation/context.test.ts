import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";
import { createVoiceActionBindings } from "./actions.ts";
import { presentThreadShell } from "../state/models.ts";
import { v2ThreadShell } from "../state/orchestrationV2TestFixtures.ts";

describe("voice get_context", () => {
  it("tracks navigation and rejects stale route IDs as thread state changes", async () => {
    const environmentId = EnvironmentId.make("voice-environment");
    const otherEnvironmentId = EnvironmentId.make("other-environment");
    const threadId = ThreadId.make("4b3a0573-e304-4f46-83e9-cf77d1a275fa");
    const completed = presentThreadShell(environmentId, {
      ...v2ThreadShell,
      id: threadId,
      status: "completed",
    });
    let threads = [completed];
    let focused: string | null = threadId;
    const registry = AtomRegistry.make();
    type Dependencies = Parameters<typeof createVoiceActionBindings>[0];
    const bindings = createVoiceActionBindings({
      connectionAtomRuntime: Atom.runtime(
        Layer.empty,
      ) as unknown as Dependencies["connectionAtomRuntime"],
      appAtomRegistry: registry,
      serverEnvironment: {} as Dependencies["serverEnvironment"],
      projectEnvironment: {} as Dependencies["projectEnvironment"],
      threadEnvironment: {} as Dependencies["threadEnvironment"],
      randomUUID: () => "unused",
      readProjects: () => [],
      readThreadShells: () => threads,
      readThreadShell: (ref) =>
        threads.find(
          (thread) => thread.environmentId === ref.environmentId && thread.id === ref.threadId,
        ) ?? null,
      waitForProject: async () => null,
      waitForThreadShell: async () => false,
    });
    const execute = bindings.createVoiceActions(
      environmentId,
      async () => {},
      () => focused,
    );
    const context = () => execute({ action: "get_context" });
    try {
      // Completion alone does not close a thread that the user is still viewing.
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: threadId });

      focused = null;
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: null });

      focused = threadId;
      threads = [];
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: null });

      threads = [{ ...completed, archivedAt: "2026-10-13T00:00:00Z" }];
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: null });

      threads = [{ ...completed, deletedAt: "2026-10-13T00:00:00Z" }];
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: null });

      threads = [{ ...completed, environmentId: otherEnvironmentId }];
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: null });

      threads = [completed];
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: threadId });

      const next = { ...completed, id: ThreadId.make("next-thread") };
      threads = [completed, next];
      focused = next.id;
      await expect(context()).resolves.toEqual({ environmentId, currentThreadId: next.id });
    } finally {
      registry.dispose();
    }
  });
});
