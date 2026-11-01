import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  WorkflowId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Persistence from "../../../persistence/Sqlite.ts";
import * as Scheduler from "../../../scheduling/Scheduler.ts";
import * as Workflows from "../../../workflows/WorkflowService.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Handlers from "./handlers.ts";
import { WorkflowToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:workflow");
const runId = RunId.make("run:mcp-test");
const id = WorkflowId.make("workflow:test");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:test"),
  requestNamespace: "workflow:test",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
  client: undefined,
  thread: {
    threadId,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerSessionId: "session:test",
  },
};
const dependencies = Layer.mergeAll(
  Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
  }),
);
const layerTest = McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(
  Layer.provideMerge(Workflows.layer.pipe(Layer.provide(dependencies))),
  Layer.provideMerge(dependencies),
  Layer.provideMerge(Layer.succeed(McpInvocationContext.McpInvocationContext, scope)),
  Layer.provide(Persistence.layerMemory),
);

it.effect(
  "claims and reports through MCP using the live caller's run, while rejecting foreign-thread execution",
  () =>
    Effect.gen(function* () {
      const service = yield* Workflows.WorkflowService;
      const toolkit = yield* WorkflowToolkit;
      const created = yield* service.create({
        id,
        threadId,
        title: "Verify",
        stages: [
          {
            title: "Check",
            instruction: "Check the artifact",
            successCriteria: "Hash matched",
            maxAttempts: 2,
          },
        ],
      });
      yield* service.control({
        id,
        threadId,
        commandId: CommandId.make("start"),
        expectedRevision: 0,
        action: "start",
      });
      const foreign = yield* toolkit
        .handle("workflow_claim", { id, threadId: ThreadId.make("other") })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(foreign.at(-1)?.result).toMatchObject({ code: "parent_not_active" });
      const claimed = yield* toolkit
        .handle("workflow_claim", { id, threadId })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(claimed.at(-1)?.result).toMatchObject({ stageIndex: 0, attempt: 1 });
      expect((yield* service.get(id, threadId)).workflow.stages[0]?.attempts[0]?.runId).toBe(runId);
      const reported = yield* toolkit
        .handle("workflow_report", {
          id,
          threadId,
          stageIndex: 0,
          attempt: 1,
          status: "succeeded",
          evidence: "Artifact hash matched.",
        })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(reported.at(-1)?.result).toMatchObject({ workflow: { status: "succeeded" } });
      expect(created.workflow.status).toBe("ready");
    }).pipe(Effect.provide(layerTest)),
);

it.effect("a read-only outside MCP client can inspect but cannot start a workflow", () =>
  Effect.gen(function* () {
    const service = yield* Workflows.WorkflowService;
    const toolkit = yield* WorkflowToolkit;
    yield* service.create({
      id,
      threadId,
      title: "Verify",
      stages: [{ title: "Check", instruction: "Check", successCriteria: "Passed", maxAttempts: 1 }],
    });
    const outside: McpInvocationContext.McpInvocationScope = {
      ...scope,
      thread: undefined,
      client: { sessionId: "outside", label: "Read only", access: "read-only" },
    };
    const read = yield* toolkit
      .handle("workflow_get", { id, threadId })
      .pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.provideService(McpInvocationContext.McpInvocationContext, outside),
      );
    expect(read.at(-1)?.result).toMatchObject({ workflow: { status: "ready" } });
    const write = yield* toolkit
      .handle("workflow_control", {
        id,
        threadId,
        commandId: CommandId.make("start"),
        expectedRevision: 0,
        action: "start",
      })
      .pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.provideService(McpInvocationContext.McpInvocationContext, outside),
      );
    expect(write.at(-1)?.result).toMatchObject({ code: "capability_denied" });
    expect((yield* service.get(id, threadId)).workflow.status).toBe("ready");
  }).pipe(Effect.provide(layerTest)),
);
