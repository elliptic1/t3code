import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Workflows from "../../../workflows/WorkflowService.ts";
import { readCaller } from "../../threadAccess.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { WorkflowToolkit } from "./tools.ts";

const workflowRun = Effect.fn("mcp.workflowRun")(function* (threadId: ThreadId) {
  const context = yield* readCaller();
  if (context.caller?.id !== threadId || context.caller.activeRunId === null) {
    return yield* new OrchestratorMcpFailure({
      code: "parent_not_active",
      message: "Only an active agent in the workflow's own thread can execute a stage.",
    });
  }
  return context.caller.activeRunId;
});

const handlers = {
  workflow_create: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) => Effect.flatMap(Workflows.WorkflowService, (service) => service.create(input)),
  ),
  workflow_list: McpToolAccess.reads((input) =>
    Effect.flatMap(Workflows.WorkflowService, (service) => service.list(input.threadId)),
  ),
  workflow_get: McpToolAccess.reads((input) =>
    Effect.flatMap(Workflows.WorkflowService, (service) => service.get(input.id, input.threadId)),
  ),
  workflow_control: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) => Effect.flatMap(Workflows.WorkflowService, (service) => service.control(input)),
  ),
  workflow_claim: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const runId = yield* workflowRun(input.threadId);
        const service = yield* Workflows.WorkflowService;
        return yield* service.claim({ ...input, runId });
      }),
  ),
  workflow_report: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const runId = yield* workflowRun(input.threadId);
        const service = yield* Workflows.WorkflowService;
        return yield* service.report({ ...input, runId });
      }),
  ),
} satisfies McpToolAccess.Handlers<typeof WorkflowToolkit.tools>;

export const layer = McpToolAccess.toLayer(WorkflowToolkit, handlers);
