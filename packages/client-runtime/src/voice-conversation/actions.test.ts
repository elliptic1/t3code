import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Layer from "effect/Layer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createVoiceActionBindings } from "./actions.ts";
import { v2Project, v2ThreadShell, v2Projection } from "../state/orchestrationV2TestFixtures.ts";
import { presentThreadShell } from "../state/models.ts";
import * as Runtime from "../state/runtime.ts";

// Only the RPC boundary is replaced; the voice action constructs the real launch request.
vi.mock("../state/runtime.ts", async (importOriginal) => {
  const original = await importOriginal<typeof Runtime>();
  return { ...original, runAtomCommand: vi.fn() };
});

afterEach(() => vi.resetAllMocks());

describe("voice thread launch", () => {
  it.each(["local", "worktree"] as const)(
    "submits the task during a %s launch even when the UI never observes the thread",
    async (mode) => {
      const environmentId = EnvironmentId.make("voice-environment");
      const registry = AtomRegistry.make();
      const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
      const settingsAtom = Atom.make({
        ...DEFAULT_SERVER_SETTINGS,
        defaultModelSelection: modelSelection,
        defaultThreadEnvMode: mode,
      });
      type Dependencies = Parameters<typeof createVoiceActionBindings>[0];
      const openThread = vi.fn(async () => {});
      const bindings = createVoiceActionBindings({
        connectionAtomRuntime: Atom.runtime(
          Layer.empty,
        ) as unknown as Dependencies["connectionAtomRuntime"],
        appAtomRegistry: registry,
        serverEnvironment: {
          settingsValueAtom: () => settingsAtom,
          configValueAtom: () => Atom.make(null),
        } as unknown as Dependencies["serverEnvironment"],
        projectEnvironment: {} as Dependencies["projectEnvironment"],
        threadEnvironment: {} as Dependencies["threadEnvironment"],
        randomUUID: () => "created-thread",
        readProjects: () => [{ ...v2Project, environmentId }],
        readThreadShells: () => [],
        readThreadShell: () => null,
        waitForProject: async () => null,
        waitForThreadShell: async () => false,
      });
      vi.mocked(Runtime.runAtomCommand).mockResolvedValue(AsyncResult.success({}));
      try {
        await expect(
          bindings.createVoiceActions(
            environmentId,
            openThread,
          )({
            action: "create_thread",
            projectId: v2Project.id,
            title: "Fix checkout",
            message: "Investigate the checkout error and fix it.",
          }),
        ).rejects.toThrow("Do not create it again");
        expect(Runtime.runAtomCommand).toHaveBeenCalledTimes(1);
        expect(vi.mocked(Runtime.runAtomCommand).mock.calls[0]?.[2]).toMatchObject({
          environmentId,
          input: {
            title: "Fix checkout",
            modelSelection,
            initialMessage: {
              text: "Investigate the checkout error and fix it.",
              attachments: [],
            },
            workspaceStrategy: { type: mode === "worktree" ? "worktree" : "root" },
          },
        });
        expect(openThread).not.toHaveBeenCalled();
      } finally {
        registry.dispose();
      }
    },
  );
});

describe("voice preferences", () => {
  it("reads and saves only the connected environment's instructions and reports failed saves", async () => {
    const environmentId = EnvironmentId.make("voice-preferences");
    const registry = AtomRegistry.make();
    const settingsAtom = Atom.make({
      ...DEFAULT_SERVER_SETTINGS,
      voiceInstructions: "Act as my COO.",
    });
    type Dependencies = Parameters<typeof createVoiceActionBindings>[0];
    const bindings = createVoiceActionBindings({
      connectionAtomRuntime: Atom.runtime(
        Layer.empty,
      ) as unknown as Dependencies["connectionAtomRuntime"],
      appAtomRegistry: registry,
      serverEnvironment: {
        settingsValueAtom: () => settingsAtom,
        updateSettings: {},
      } as unknown as Dependencies["serverEnvironment"],
      projectEnvironment: {} as Dependencies["projectEnvironment"],
      threadEnvironment: {} as Dependencies["threadEnvironment"],
      randomUUID: () => "unused",
      readProjects: () => [],
      readThreadShells: () => [],
      readThreadShell: () => null,
      waitForProject: async () => null,
      waitForThreadShell: async () => false,
    });
    const execute = bindings.createVoiceActions(environmentId, async () => {});
    try {
      await expect(execute({ action: "get_voice_settings" })).resolves.toEqual({
        instructions: "Act as my COO.",
      });
      for (const instructions of ["Act as my COO. Prioritize profitability.", ""]) {
        vi.mocked(Runtime.runAtomCommand).mockResolvedValue(
          AsyncResult.success({ ...DEFAULT_SERVER_SETTINGS, voiceInstructions: instructions }),
        );
        await expect(execute({ action: "update_voice_settings", instructions })).resolves.toEqual({
          instructions,
        });
        expect(vi.mocked(Runtime.runAtomCommand).mock.lastCall?.[2]).toEqual({
          environmentId,
          input: { patch: { voiceInstructions: instructions } },
        });
      }
      vi.mocked(Runtime.runAtomCommand).mockRejectedValue(new Error("Permission denied"));
      await expect(
        execute({ action: "update_voice_settings", instructions: "Changed" }),
      ).rejects.toThrow("Permission denied");
    } finally {
      registry.dispose();
    }
  });
});

describe("voice thread model visibility", () => {
  it("exposes assigned models in listings, fresh reads, and launches without changing selection", async () => {
    const environmentId = EnvironmentId.make("voice-models");
    const registry = AtomRegistry.make();
    const selected = {
      instanceId: ProviderInstanceId.make("custom-provider"),
      model: "custom-coding-model",
      options: { reasoningEffort: "high" },
    };
    const shell = presentThreadShell(environmentId, v2ThreadShell);
    const settingsAtom = Atom.make({
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: selected,
    });
    type Dependencies = Parameters<typeof createVoiceActionBindings>[0];
    const bindings = createVoiceActionBindings({
      connectionAtomRuntime: Atom.runtime(
        Layer.empty,
      ) as unknown as Dependencies["connectionAtomRuntime"],
      appAtomRegistry: registry,
      serverEnvironment: {
        settingsValueAtom: () => settingsAtom,
        configValueAtom: () => Atom.make(null),
      } as unknown as Dependencies["serverEnvironment"],
      projectEnvironment: {} as Dependencies["projectEnvironment"],
      threadEnvironment: {} as Dependencies["threadEnvironment"],
      randomUUID: () => "created-thread",
      readProjects: () => [{ ...v2Project, environmentId }],
      readThreadShells: () => [shell, { ...shell, environmentId: EnvironmentId.make("other") }],
      readThreadShell: (ref) => (ref.threadId === shell.id ? shell : null),
      waitForProject: async () => null,
      waitForThreadShell: async () => true,
    });
    const execute = bindings.createVoiceActions(environmentId, async () => {});
    try {
      vi.mocked(Runtime.runAtomCommand).mockResolvedValue(
        AsyncResult.success({
          threads: [{ ...v2ThreadShell, id: ThreadId.make("archived"), modelSelection: selected }],
        }),
      );
      await expect(execute({ action: "list_threads" })).resolves.toMatchObject({
        totalActiveMatches: 1,
        active: [{ id: shell.id, modelSelection: shell.modelSelection }],
        archived: [{ id: "archived", modelSelection: selected }],
      });
      // The authoritative read can be newer than the client shell or project default.
      vi.mocked(Runtime.runAtomCommand).mockResolvedValue(
        AsyncResult.success({
          ...v2Projection,
          thread: { ...v2Projection.thread, modelSelection: selected },
        }),
      );
      await expect(execute({ action: "read_thread", threadId: shell.id })).resolves.toMatchObject({
        modelSelection: selected,
        messages: [],
      });
      vi.mocked(Runtime.runAtomCommand).mockResolvedValue(AsyncResult.success({}));
      await expect(
        execute({
          action: "create_thread",
          projectId: v2Project.id,
          title: "Task",
          message: "Do the task",
        }),
      ).resolves.toEqual({ threadId: "created-thread", modelSelection: selected });
      expect(vi.mocked(Runtime.runAtomCommand).mock.lastCall?.[2]).toMatchObject({
        environmentId,
        input: { modelSelection: selected, initialMessage: { text: "Do the task" } },
      });
    } finally {
      registry.dispose();
    }
  });
});
