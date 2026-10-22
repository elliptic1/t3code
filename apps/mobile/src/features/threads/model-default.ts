import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import type {
  ModelSelection,
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";

export function configuredDefaultModelSelection(
  settings: ServerSettings,
  projectId: ProjectId | null,
): ModelSelection | null {
  return resolveProjectSettings(settings, projectId).settings.defaultModelSelection;
}

export function modelSelectionMatchesDefault(
  selection: ModelSelection,
  defaultSelection: ModelSelection | null,
): boolean {
  return (
    selection.instanceId === defaultSelection?.instanceId &&
    selection.model === defaultSelection.model
  );
}

export function defaultModelSettingsPatch(
  settings: ServerSettings,
  projectId: ProjectId | null,
  selection: ModelSelection,
): ServerSettingsPatch {
  if (projectId === null) {
    return { defaultModelSelection: selection };
  }

  return {
    projectSettingsOverrides: {
      [projectId]: {
        ...settings.projectSettingsOverrides[projectId],
        defaultModelSelection: selection,
      },
    },
  };
}
