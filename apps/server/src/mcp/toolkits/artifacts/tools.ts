import {
  ThreadArtifactListResult,
  ThreadArtifactPublishInput,
  ThreadArtifactRenameInput,
  ThreadArtifactChangeInput,
  ThreadArtifactResult,
  ThreadArtifactError,
  OrchestratorMcpFailure,
  ThreadArtifactListInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Artifacts from "../../../artifacts/ThreadArtifactService.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Invocation from "../../McpInvocationContext.ts";

const dependencies = [
  Artifacts.ThreadArtifactService,
  Threads.ThreadManagementService,
  Invocation.McpInvocationContext,
];
const failure = Schema.Union([ThreadArtifactError, OrchestratorMcpFailure]);
export const ArtifactToolkit = Toolkit.make(
  Tool.make("artifact_list", {
    description:
      "List durable files in a thread's Artifacts area. Omit threadId for your own thread. Artifacts are hosted by the environment and downloadable from web, desktop and mobile, including after the thread is settled.",
    parameters: Schema.Struct({
      threadId: Schema.optionalKey(ThreadArtifactListInput.fields.threadId),
    }),
    success: ThreadArtifactListResult,
    failure,
    failureMode: "return",
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("artifact_publish", {
    description:
      "Copy a regular file from an absolute path on this server into a thread's durable Artifacts area (up to 2 GB). Supply name and MIME type (application/octet-stream if unknown). The source may be temporary; publishing copies its bytes. To edit/replace a file, supply replace with its id and latest expectedRevision from artifact_list. Omit threadId for your own thread. Clients can download the artifact through their existing connection; no temporary HTTP server is needed.",
    parameters: Schema.Struct({
      ...ThreadArtifactPublishInput.fields,
      threadId: Schema.optionalKey(ThreadArtifactListInput.fields.threadId),
    }),
    success: ThreadArtifactResult,
    failure,
    failureMode: "return",
    dependencies,
  }).annotate(Tool.Destructive, true),
  Tool.make("artifact_rename", {
    description:
      "Rename a published artifact, keeping its bytes. Pass id and expectedRevision from artifact_list. Omit threadId for your own thread.",
    parameters: Schema.Struct({
      ...ThreadArtifactRenameInput.fields,
      threadId: Schema.optionalKey(ThreadArtifactListInput.fields.threadId),
    }),
    success: ThreadArtifactResult,
    failure,
    failureMode: "return",
    dependencies,
  }).annotate(Tool.Destructive, true),
  Tool.make("artifact_delete", {
    description:
      "Delete an artifact and its hosted file. Pass id and expectedRevision from artifact_list. Omit threadId for your own thread.",
    parameters: Schema.Struct({
      ...ThreadArtifactChangeInput.fields,
      threadId: Schema.optionalKey(ThreadArtifactListInput.fields.threadId),
    }),
    success: Schema.Void,
    failure,
    failureMode: "return",
    dependencies,
  }).annotate(Tool.Destructive, true),
);
