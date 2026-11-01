import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  EnvironmentId,
  ProviderInstanceId,
  AuthSettingsWriteScope,
  requiredScopesForServerSettingsPatch,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Layer from "effect/Layer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createVoiceActionBindings } from "./actions.ts";
import { createVoiceToolRunner } from "./tools.ts";
import { v2Project, v2ThreadShell } from "../state/orchestrationV2TestFixtures.ts";
import { presentThreadShell } from "../state/models.ts";
import * as Runtime from "../state/runtime.ts";

vi.mock("../state/runtime.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Runtime>()),
  runAtomCommand: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

const environmentId = EnvironmentId.make("voice-models");
const selection = { instanceId: ProviderInstanceId.make("codex"), model: "custom-model" };
function setup() {
  const registry = AtomRegistry.make();
  const settingsAtom = Atom.make({
    ...DEFAULT_SERVER_SETTINGS,
    projectSettingsFolded: true,
    defaultModelSelection: v2ThreadShell.modelSelection as ModelSelection | null,
    projectSettingsOverrides: { [v2Project.id]: { defaultAutoPull: true } },
    providerInstances: {
      codex: { driver: "codex", enabled: true, config: { customModels: ["custom-model"] } },
    },
  });
  const configAtom = Atom.make({
    environment: { capabilities: { projectSettingsOverrides: true } },
    providers: [
      {
        instanceId: selection.instanceId,
        driver: "codex",
        enabled: true,
        installed: true,
        availability: "available",
        models: [{ slug: "gpt-5.4", name: "GPT", isDefault: true }],
      },
      {
        instanceId: "disabled",
        driver: "codex",
        enabled: false,
        installed: true,
        models: [{ slug: "hidden", name: "Hidden" }],
      },
    ],
  });
  type Dependencies = Parameters<typeof createVoiceActionBindings>[0];
  const shell = presentThreadShell(environmentId, v2ThreadShell);
  const bindings = createVoiceActionBindings({
    connectionAtomRuntime: Atom.runtime(
      Layer.empty,
    ) as unknown as Dependencies["connectionAtomRuntime"],
    appAtomRegistry: registry,
    serverEnvironment: {
      settingsValueAtom: () => settingsAtom,
      configValueAtom: () => configAtom,
      updateSettings: {},
    } as unknown as Dependencies["serverEnvironment"],
    projectEnvironment: {} as Dependencies["projectEnvironment"],
    threadEnvironment: { updateMetadata: {} } as Dependencies["threadEnvironment"],
    randomUUID: () => "new-thread",
    readProjects: () => [{ ...v2Project, environmentId }],
    readThreadShells: () => [shell],
    readThreadShell: (ref) => (ref.threadId === shell.id ? shell : null),
    waitForProject: async () => null,
    waitForThreadShell: async () => true,
  });
  return {
    registry,
    settingsAtom,
    configAtom,
    execute: bindings.createVoiceActions(environmentId, async () => {}),
  };
}

describe("voice model control", () => {
  it("decodes model options and reset requests, rejecting incomplete selections", async () => {
    const execute = vi.fn(async () => ({}));
    const run = createVoiceToolRunner(execute);
    const modelSelection = { ...selection, options: [{ id: "fastMode", value: true }] };
    for (const [index, value] of [modelSelection, null].entries()) {
      expect(
        JSON.parse(
          await run({
            call_id: String(index),
            name: "set_project_model",
            arguments: JSON.stringify({ projectId: v2Project.id, modelSelection: value }),
          }),
        ).ok,
      ).toBe(true);
      expect(execute).toHaveBeenLastCalledWith({
        action: "set_project_model",
        projectId: v2Project.id,
        modelSelection: value,
      });
    }
    expect(
      JSON.parse(
        await run({
          call_id: "invalid",
          name: "set_thread_model",
          arguments: JSON.stringify({
            threadId: v2ThreadShell.id,
            modelSelection: { model: "missing-provider" },
          }),
        }),
      ).ok,
    ).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("discovers custom models and exposes effective project defaults and fallback", async () => {
    const { registry, settingsAtom, execute } = setup();
    try {
      await expect(execute({ action: "list_models" })).resolves.toEqual([
        {
          instanceId: "codex",
          name: "codex",
          models: [
            { model: "gpt-5.4", name: "GPT" },
            { model: "custom-model", name: "custom-model" },
          ],
        },
      ]);
      await expect(execute({ action: "list_projects" })).resolves.toMatchObject([
        {
          id: v2Project.id,
          modelOverride: null,
          defaultModelSelection: v2ThreadShell.modelSelection,
          source: "environment",
        },
      ]);
      registry.set(settingsAtom, { ...registry.get(settingsAtom), defaultModelSelection: null });
      await expect(
        execute({ action: "get_project_model", projectId: v2Project.id }),
      ).resolves.toMatchObject({
        defaultModelSelection: v2ThreadShell.modelSelection,
        source: "provider_fallback",
      });
    } finally {
      registry.dispose();
    }
  });

  it("sets and clears only the model override, preserving unrelated project settings", async () => {
    const { registry, settingsAtom, execute } = setup();
    try {
      for (const modelSelection of [selection, null]) {
        const overrides = modelSelection
          ? { defaultAutoPull: true, defaultModelSelection: modelSelection }
          : { defaultAutoPull: true };
        const saved = {
          ...registry.get(settingsAtom),
          projectSettingsOverrides: { [v2Project.id]: overrides },
        };
        vi.mocked(Runtime.runAtomCommand).mockResolvedValue(AsyncResult.success(saved));
        await expect(
          execute({ action: "set_project_model", projectId: v2Project.id, modelSelection }),
        ).resolves.toMatchObject({
          modelOverride: modelSelection,
          defaultModelSelection: modelSelection ?? v2ThreadShell.modelSelection,
          source: modelSelection ? "project" : "environment",
        });
        expect(vi.mocked(Runtime.runAtomCommand).mock.lastCall?.[2]).toEqual({
          environmentId,
          input: { patch: { projectSettingsOverrides: { [v2Project.id]: overrides } } },
        });
        registry.set(settingsAtom, saved);
      }
      expect(
        requiredScopesForServerSettingsPatch({
          projectSettingsOverrides: { [v2Project.id]: { defaultModelSelection: selection } },
        }),
      ).toEqual([AuthSettingsWriteScope]);
      vi.mocked(Runtime.runAtomCommand).mockRejectedValue(new Error("Missing settings:write"));
      await expect(
        execute({
          action: "set_project_model",
          projectId: v2Project.id,
          modelSelection: selection,
        }),
      ).rejects.toThrow("settings:write");
    } finally {
      registry.dispose();
    }
  });

  it("overrides a launch or existing thread without writing project defaults", async () => {
    const { registry, execute } = setup();
    try {
      vi.mocked(Runtime.runAtomCommand).mockResolvedValue(AsyncResult.success({}));
      const run = createVoiceToolRunner(execute);
      const result = JSON.parse(
        await run({
          call_id: "launch",
          name: "create_thread",
          arguments: JSON.stringify({
            projectId: v2Project.id,
            title: "Task",
            message: "Do work",
            modelSelection: selection,
          }),
        }),
      );
      expect(result).toEqual({
        ok: true,
        result: { threadId: "new-thread", modelSelection: selection },
      });
      expect(vi.mocked(Runtime.runAtomCommand).mock.lastCall?.[2]).toMatchObject({
        environmentId,
        input: { modelSelection: selection, initialMessage: { text: "Do work" } },
      });
      await expect(
        execute({
          action: "set_thread_model",
          threadId: v2ThreadShell.id,
          modelSelection: selection,
        }),
      ).resolves.toEqual({ threadId: v2ThreadShell.id, modelSelection: selection });
      expect(vi.mocked(Runtime.runAtomCommand).mock.lastCall?.[2]).toEqual({
        environmentId,
        input: { threadId: v2ThreadShell.id, modelSelection: selection },
      });
      expect(Runtime.runAtomCommand).toHaveBeenCalledTimes(2);
    } finally {
      registry.dispose();
    }
  });

  it("rejects unknown models, other-environment projects, and unsupported servers before mutation", async () => {
    const { registry, configAtom, execute } = setup();
    try {
      await expect(
        execute({ action: "set_project_model", projectId: "other", modelSelection: selection }),
      ).rejects.toThrow("Project not found");
      await expect(
        execute({
          action: "set_thread_model",
          threadId: v2ThreadShell.id,
          modelSelection: { ...selection, model: "invented" },
        }),
      ).rejects.toThrow("list_models");
      registry.set(configAtom, {
        ...registry.get(configAtom),
        environment: { capabilities: { projectSettingsOverrides: false } },
      });
      await expect(
        execute({
          action: "set_project_model",
          projectId: v2Project.id,
          modelSelection: selection,
        }),
      ).rejects.toThrow("Update its server");
      expect(Runtime.runAtomCommand).not.toHaveBeenCalled();
    } finally {
      registry.dispose();
    }
  });
});
