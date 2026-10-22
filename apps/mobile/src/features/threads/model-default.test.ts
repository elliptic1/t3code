import {
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
  type ServerSettings,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import {
  configuredDefaultModelSelection,
  defaultModelSettingsPatch,
  modelSelectionMatchesDefault,
} from "./model-default";

describe("model defaults", () => {
  const model: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1" };
  const otherModel: ModelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  };

  it("uses a project default before the server default", () => {
    const projectId = ProjectId.make("project-a");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: otherModel,
      projectSettingsOverrides: {
        ...DEFAULT_SERVER_SETTINGS.projectSettingsOverrides,
        [projectId]: { defaultModelSelection: model },
      },
    };

    expect(configuredDefaultModelSelection(settings, projectId)).toEqual(model);
    expect(configuredDefaultModelSelection(settings, null)).toEqual(otherModel);
  });

  it("writes a project default without replacing other project settings", () => {
    const projectId = ProjectId.make("project-a");
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        ...DEFAULT_SERVER_SETTINGS.projectSettingsOverrides,
        [projectId]: { defaultRuntimeMode: "plan" },
      },
    };

    expect(defaultModelSettingsPatch(settings, projectId, model)).toEqual({
      projectSettingsOverrides: {
        [projectId]: { defaultRuntimeMode: "plan", defaultModelSelection: model },
      },
    });
  });

  it("writes the server default when no project is selected", () => {
    expect(defaultModelSettingsPatch(DEFAULT_SERVER_SETTINGS, null, model)).toEqual({
      defaultModelSelection: model,
    });
  });

  it("matches defaults by provider and model", () => {
    expect(
      modelSelectionMatchesDefault(model, { ...model, options: [{ id: "effort", value: "high" }] }),
    ).toBe(true);
    expect(modelSelectionMatchesDefault(otherModel, model)).toBe(false);
    expect(modelSelectionMatchesDefault(model, null)).toBe(false);
  });
});
