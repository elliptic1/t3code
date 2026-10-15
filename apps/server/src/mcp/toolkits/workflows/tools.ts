import {
  WorkflowCreateInput,
  WorkflowControlInput,
  WorkflowListInput,
  WorkflowListResult,
  WorkflowClaimInput,
  WorkflowClaimResult,
  WorkflowReportInput,
  WorkflowResult,
  WorkflowError,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Workflows from "../../../workflows/WorkflowService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const workflowDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Workflows.WorkflowService,
];
const workflowFailure = Schema.Union([WorkflowError, OrchestratorMcpFailure]);
const WorkflowCreateTool = Tool.make("workflow_create", {
  description:
    "Create a durable sequential workflow attached to an existing thread. Supply a stable UUID as id, a title, and stages with instruction, successCriteria and maxAttempts (1-10). Creation saves a draft and executes nothing. Start it with workflow_control. Each stage runs in its own turn using that thread's provider and permissions. Record exact source commits and artifact hashes in evidence. Do not put credentials in instructions or evidence.",
  parameters: WorkflowCreateInput,
  success: WorkflowResult,
  failure: workflowFailure,
  failureMode: "return",
  dependencies: workflowDependencies,
}).annotate(Tool.Destructive, true);
const WorkflowListTool = Tool.make("workflow_list", {
  description:
    "Read the latest 50 durable workflows for a thread, including stage status, attempt counts and short evidence excerpts. Use workflow_get for full instructions and attempt history. Evidence is agent-reported; an agent turn ending successfully does not complete a stage.",
  parameters: WorkflowListInput,
  success: WorkflowListResult,
  failure: workflowFailure,
  failureMode: "return",
  dependencies: workflowDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const WorkflowGetTool = Tool.make("workflow_get", {
  description:
    "Read a workflow's full instructions, success criteria and attempt evidence. Use this to inspect earlier effects and exact source/artifact identities before retrying or confirming installation.",
  parameters: WorkflowClaimInput,
  success: WorkflowResult,
  failure: workflowFailure,
  failureMode: "return",
  dependencies: workflowDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const WorkflowControlTool = Tool.make("workflow_control", {
  description:
    "Start, pause, resume, retry or cancel a workflow. Read its revision first and pass expectedRevision plus a stable commandId for this action. Retries keep successful stages and consume the failed stage's remaining attempt budget. Resume a waiting stage only when its missing input is available. Pause and cancel prevent further stages; they do not interrupt already executing external effects. Inspect those effects before retrying an interrupted stage.",
  parameters: WorkflowControlInput,
  success: WorkflowResult,
  failure: workflowFailure,
  failureMode: "return",
  dependencies: workflowDependencies,
}).annotate(Tool.Destructive, true);
const WorkflowClaimTool = Tool.make("workflow_claim", {
  description:
    "Claim the next stage of a running workflow in YOUR thread. The server binds it to your current run and returns stageIndex and attempt. Repeated claims in that run return the same attempt. Execute only that stage and inspect prior attempts before repeating effects. Report its outcome with workflow_report, then end the turn; T3 dispatches the next stage.",
  parameters: WorkflowClaimInput,
  success: WorkflowClaimResult,
  failure: workflowFailure,
  failureMode: "return",
  dependencies: workflowDependencies,
}).annotate(Tool.Destructive, true);
const WorkflowReportTool = Tool.make("workflow_report", {
  description:
    "Record the claimed stage's outcome with stageIndex, attempt, status and evidence addressing its successCriteria. Only the run that claimed this attempt can report it. Use waiting when input or manual confirmation is missing; failed when verification fails. A succeeded report queues the next stage. Publication does not prove installation. End the turn after reporting. Evidence is persisted and visible to clients; do not include credentials.",
  parameters: WorkflowReportInput,
  success: WorkflowResult,
  failure: workflowFailure,
  failureMode: "return",
  dependencies: workflowDependencies,
}).annotate(Tool.Destructive, true);

export const WorkflowToolkit = Toolkit.make(
  WorkflowCreateTool,
  WorkflowListTool,
  WorkflowGetTool,
  WorkflowControlTool,
  WorkflowClaimTool,
  WorkflowReportTool,
);
