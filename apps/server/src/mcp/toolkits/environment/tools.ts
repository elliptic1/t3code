import {
  BackgroundActivityProfile,
  BackgroundActivityProfileSelection,
  CLIENT_LOG_MAX_LINES,
  ClientActivityClientId,
  ClientLogReadResult,
  ExecutionEnvironmentDescriptor,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ServerSettings,
  ServerSettingsPatch,
  clampedPositiveInt,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ClientLogs from "../../../diagnostics/ClientLogs.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const PreferenceFields = {
  voiceInstructions: ServerSettings.fields.voiceInstructions,
  defaultThreadEnvMode: ServerSettings.fields.defaultThreadEnvMode,
  newWorktreesStartFromOrigin: ServerSettings.fields.newWorktreesStartFromOrigin,
  enableProviderUpdateChecks: ServerSettings.fields.enableProviderUpdateChecks,
  backgroundActivity: Schema.Struct({ profile: BackgroundActivityProfileSelection }),
  sourceControlWritingStyle: Schema.Struct({
    mode: Schema.String,
    followChangeRequestTemplates: Schema.Boolean,
    customInstructions: Schema.String,
    truncated: Schema.Boolean,
  }),
};
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    Settings.ServerSettingsService,
    ThreadCommandExecutor.ThreadCommandExecutor,
  ],
};
const EnvironmentReadTool = Tool.make("t3_environment_read", {
  ...shared,
  description:
    "Read this server's identity and preferences. Providers and models: `orchestrator_capabilities`.",
  parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
  success: Schema.Struct({
    environmentId: ExecutionEnvironmentDescriptor.fields.environmentId,
    label: Schema.String,
    serverVersion: Schema.String,
    platform: ExecutionEnvironmentDescriptor.fields.platform,
    preferences: Schema.Struct(PreferenceFields),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const EnvironmentPreferencesTool = Tool.make("t3_environment_preferences_update", {
  ...shared,
  description:
    "Update environment-wide preferences. Live full-access or default caller thread only. Omitted fields are unchanged; `customInstructions: ''` clears it.",
  parameters: Schema.Struct({
    voiceInstructions: ServerSettingsPatch.fields.voiceInstructions,
    environmentId: OrchestratorMcpEnvironmentTarget,
    defaultThreadEnvMode: ServerSettingsPatch.fields.defaultThreadEnvMode,
    newWorktreesStartFromOrigin: ServerSettingsPatch.fields.newWorktreesStartFromOrigin,
    enableProviderUpdateChecks: ServerSettingsPatch.fields.enableProviderUpdateChecks,
    backgroundActivity: Schema.optionalKey(Schema.Struct({ profile: BackgroundActivityProfile })),
    sourceControlWritingStyle: ServerSettingsPatch.fields.sourceControlWritingStyle,
  }),
  success: Schema.Struct(PreferenceFields),
}).annotate(Tool.Destructive, true);
const ClientLogsReadTool = Tool.make("t3_client_logs_read", {
  ...shared,
  dependencies: [...shared.dependencies, ClientLogs.ClientLogs],
  description:
    "Read the T3 Code Android app's own logcat (crashes, errors, connection issues), fetched from the phone over its T3 connection, so it works where adb cannot reach. Falls back to the newest saved log; check `status` and `capturedAt`. `path` holds the full log.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    clientId: Schema.optionalKey(
      ClientActivityClientId.annotate({
        description: "One phone's id from an earlier result. Omit to take the first that answers.",
      }),
    ),
    maxLines: Schema.optionalKey(
      clampedPositiveInt(CLIENT_LOG_MAX_LINES).annotate({
        description: "Logcat lines to capture. Default 5000.",
      }),
    ),
  }),
  success: ClientLogReadResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const EnvironmentToolkit = Toolkit.make(
  EnvironmentReadTool,
  EnvironmentPreferencesTool,
  ClientLogsReadTool,
);
