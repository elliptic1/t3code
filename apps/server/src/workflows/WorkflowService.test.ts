import { expect, it } from "@effect/vitest";
import {
  APK_WORKFLOW_STAGES,
  CommandId,
  RunId,
  ThreadId,
  WorkflowId,
  type Workflow,
  type WorkflowCreateInput,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { idleThreadProjection, liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Persistence from "../persistence/Sqlite.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as Workflows from "./WorkflowService.ts";

const threadId = ThreadId.make("workflow-thread");
const runId = RunId.make("workflow-run");
const definition: WorkflowCreateInput = {
  id: WorkflowId.make("apk-workflow"),
  threadId,
  title: "Build and confirm",
  stages: [
    {
      title: "Build",
      instruction: "Build an APK",
      successCriteria: "APK and hash recorded",
      maxAttempts: 2,
    },
    {
      title: "Install",
      instruction: "Await manual installation",
      successCriteria: "Installation confirmed",
      maxAttempts: 2,
    },
  ],
};
const control = (
  workflow: Workflow,
  action: "start" | "pause" | "resume" | "retry" | "cancel",
  command = `${action}:${workflow.revision}`,
) => ({
  id: workflow.id,
  threadId,
  commandId: CommandId.make(command),
  expectedRevision: workflow.revision,
  action,
});

function harness() {
  let activeRunId = runId;
  let ended = false;
  const unavailable = new Set<ThreadId>();
  const deliveries: ThreadManagement.ThreadManagementSendInput[] = [];
  const layer = Workflows.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) =>
            Effect.sync(() => (unavailable.has(id) ? null : liveThreadShell(id, { activeRunId }))),
          getThreadRecords: (id) =>
            Effect.sync(() => ({
              ...idleThreadProjection(liveThreadShell(id)),
              // This external fixture only exposes the fields the workflow reads.
              runs: [
                {
                  id: activeRunId,
                  status: ended ? "interrupted" : "running",
                } as OrchestrationV2Run,
              ],
            })),
          sendToThread: (input) =>
            Effect.sync(() => {
              deliveries.push(input);
              // Workflow dispatch uses the receipt, not the returned projection.
              return { run: { id: activeRunId } } as ThreadManagement.ThreadManagementSendResult;
            }),
        }),
      ),
    ),
  );
  return {
    layer,
    deliveries,
    nextRun: () => {
      activeRunId = RunId.make(`next:${activeRunId}`);
      ended = false;
      return activeRunId;
    },
    end: () => {
      ended = true;
    },
    block: (id: ThreadId) => {
      unavailable.add(id);
    },
  };
}

it.effect(
  "persists sequential stages, requires the owning run, and queues only after reported success",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
      const created = yield* service.create(definition);
      expect(created.workflow.status).toBe("ready");
      yield* service.drain();
      expect(h.deliveries).toHaveLength(0);
      expect((yield* service.create(definition)).workflow.id).toBe(created.workflow.id);
      const started = yield* service.control(control(created.workflow, "start"));
      yield* service.drain();
      yield* service.drain();
      expect(h.deliveries).toHaveLength(1);
      expect(h.deliveries[0]?.mode).toBe("queue");
      expect(
        (yield* service.control(control(created.workflow, "pause")).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(
        (yield* service
          .claim({ id: definition.id, threadId, runId: RunId.make("foreign") })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid_transition");
      const claim = yield* service.claim({ id: definition.id, threadId, runId });
      expect(claim.stageIndex).toBe(0);
      expect((yield* service.claim({ id: definition.id, threadId, runId })).attempt).toBe(1);
      const report = {
        id: definition.id,
        threadId,
        runId,
        stageIndex: 0,
        attempt: 1,
        status: "succeeded" as const,
        evidence: "Source abc; APK /tmp/app.apk; SHA-256 def.",
      };
      const completed = yield* service.report(report);
      expect((yield* service.report(report)).workflow.revision).toBe(completed.workflow.revision);
      expect(completed.workflow.status).toBe("running");
      yield* service.drain();
      expect(h.deliveries).toHaveLength(2);
      expect(h.deliveries[1]?.text).toContain("SHA-256 def");
      const next = h.nextRun();
      const install = yield* service.claim({ id: definition.id, threadId, runId: next });
      expect(install.stageIndex).toBe(1);
      const finished = yield* service.report({
        id: definition.id,
        threadId,
        runId: next,
        stageIndex: 1,
        attempt: 1,
        status: "succeeded",
        evidence: "User confirmed installation of release abc.",
      });
      expect(finished.workflow.status).toBe("succeeded");
      yield* service.drain();
      expect(h.deliveries).toHaveLength(2);
      expect(
        (yield* service.get(definition.id, threadId)).workflow.stages[0]?.attempts[0]?.evidence,
      ).toBe(report.evidence);
      expect(started.workflow.stages[1]?.status).toBe("pending");
    }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect(
  "retry preserves successful stages, is idempotent, rejects stale attempts, and enforces limits",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
      const created = yield* service.create(definition);
      yield* service.control(control(created.workflow, "start"));
      yield* service.claim({ id: definition.id, threadId, runId });
      yield* service.report({
        id: definition.id,
        threadId,
        runId,
        stageIndex: 0,
        attempt: 1,
        status: "succeeded",
        evidence: "Build verified.",
      });
      const secondRun = h.nextRun();
      yield* service.claim({ id: definition.id, threadId, runId: secondRun });
      const failed = yield* service.report({
        id: definition.id,
        threadId,
        runId: secondRun,
        stageIndex: 1,
        attempt: 1,
        status: "failed",
        evidence: "Package did not match.",
      });
      const retryInput = control(failed.workflow, "retry");
      const retried = yield* service.control(retryInput);
      expect((yield* service.control(retryInput)).workflow.revision).toBe(
        retried.workflow.revision,
      );
      expect(retried.workflow.stages[0]?.attempts).toHaveLength(1);
      expect(retried.workflow.stages[0]?.status).toBe("succeeded");
      const thirdRun = h.nextRun();
      const secondAttempt = yield* service.claim({ id: definition.id, threadId, runId: thirdRun });
      expect(secondAttempt.attempt).toBe(2);
      expect(
        (yield* service
          .report({
            id: definition.id,
            threadId,
            runId: secondRun,
            stageIndex: 1,
            attempt: 1,
            status: "succeeded",
            evidence: "Stale success",
          })
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      const exhausted = yield* service.report({
        id: definition.id,
        threadId,
        runId: thirdRun,
        stageIndex: 1,
        attempt: 2,
        status: "failed",
        evidence: "Installation still failed.",
      });
      expect(
        (yield* service.control(control(exhausted.workflow, "retry")).pipe(Effect.flip)).reason,
      ).toBe("attempt_limit");
      expect(
        (yield* service.control({ ...retryInput, action: "cancel" }).pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect("waiting never confirms installation, and cancelling rejects late results", () =>
  Effect.gen(function* () {
    const h = harness();
    const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
    const created = yield* service.create({ ...definition, stages: [APK_WORKFLOW_STAGES.at(-1)!] });
    yield* service.control(control(created.workflow, "start"));
    yield* service.claim({ id: definition.id, threadId, runId });
    const waiting = yield* service.report({
      id: definition.id,
      threadId,
      runId,
      stageIndex: 0,
      attempt: 1,
      status: "waiting",
      evidence: "Release published; manual installation unconfirmed.",
    });
    expect(waiting.workflow.status).toBe("waiting");
    yield* service.drain();
    expect(h.deliveries).toHaveLength(0);
    const resumed = yield* service.control(control(waiting.workflow, "resume"));
    expect(resumed.workflow.stages[0]?.status).toBe("pending");
    const next = h.nextRun();
    yield* service.claim({ id: definition.id, threadId, runId: next });
    const current = yield* service.get(definition.id, threadId);
    const cancelled = yield* service.control(control(current.workflow, "cancel"));
    expect(cancelled.workflow.stages[0]?.status).toBe("cancelled");
    expect(cancelled.workflow.stages[0]?.attempts.at(-1)?.status).toBe("cancelled");
    expect(
      (yield* service
        .report({
          id: definition.id,
          threadId,
          runId: next,
          stageIndex: 0,
          attempt: 2,
          status: "succeeded",
          evidence: "Late confirmation",
        })
        .pipe(Effect.flip)).reason,
    ).toBe("invalid_transition");
    yield* service.drain();
    expect(h.deliveries).toHaveLength(0);
  }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect("pause permits the current result but blocks the next stage until resume", () =>
  Effect.gen(function* () {
    const h = harness();
    const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
    const created = yield* service.create(definition);
    yield* service.control(control(created.workflow, "start"));
    const claimed = yield* service.claim({ id: definition.id, threadId, runId });
    yield* service.control(control(claimed.workflow, "pause"));
    const result = yield* service.report({
      id: definition.id,
      threadId,
      runId,
      stageIndex: 0,
      attempt: 1,
      status: "succeeded",
      evidence: "Build completed while paused.",
    });
    expect(result.workflow.status).toBe("paused");
    yield* service.drain();
    expect(h.deliveries).toHaveLength(0);
    yield* service.control(control(result.workflow, "resume"));
    yield* service.drain();
    expect(h.deliveries).toHaveLength(1);
  }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect(
  "restart reloads pending work with the same dispatch receipt and flags unreported interrupted stages",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
      const created = yield* service.create(definition);
      yield* service.control(control(created.workflow, "start"));
      yield* service.drain();
      const firstCommand = h.deliveries[0]?.commandId;
      const sql = yield* SqlClient.SqlClient;
      // Simulate a crash after orchestration committed the send but before its
      // dispatch generation was acknowledged by the workflow service.
      yield* sql`UPDATE workflows SET dispatched_generation = 0`;
      const restarted = yield* Workflows.WorkflowService.pipe(Effect.provide(Layer.fresh(h.layer)));
      yield* restarted.drain();
      expect(h.deliveries[1]?.commandId).toBe(firstCommand);
      yield* restarted.claim({ id: definition.id, threadId, runId });
      h.end();
      yield* restarted.drain();
      const interrupted = yield* restarted.get(definition.id, threadId);
      expect(interrupted.workflow.status).toBe("failed");
      expect(interrupted.workflow.stages[0]?.attempts[0]?.evidence).toContain(
        "Inspect existing effects",
      );
      const count = h.deliveries.length;
      yield* restarted.drain();
      expect(h.deliveries).toHaveLength(count);
      yield* restarted.control(control(interrupted.workflow, "retry"));
      const next = h.nextRun();
      expect((yield* restarted.claim({ id: definition.id, threadId, runId: next })).attempt).toBe(
        2,
      );
    }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect("bounds subscription payloads and keeps full evidence available separately", () =>
  Effect.gen(function* () {
    const h = harness();
    const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
    const created = yield* service.create(definition);
    yield* service.control(control(created.workflow, "start"));
    yield* service.claim({ id: definition.id, threadId, runId });
    yield* service.report({
      id: definition.id,
      threadId,
      runId,
      stageIndex: 0,
      attempt: 1,
      status: "failed",
      evidence: "x".repeat(4000),
    });
    const summary = (yield* service.list(threadId)).workflows[0];
    expect(summary?.stages[0]?.latestEvidence).toHaveLength(500);
    expect(summary?.stages[0]).not.toHaveProperty("instruction");
    expect(
      (yield* service.get(definition.id, threadId)).workflow.stages[0]?.attempts[0]?.evidence,
    ).toHaveLength(4000);
    expect(
      (yield* service.get(definition.id, ThreadId.make("another-thread")).pipe(Effect.flip)).reason,
    ).toBe("not_found");
  }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect("a provider that ends without claiming a stage leaves an explicit failure", () =>
  Effect.gen(function* () {
    const h = harness();
    const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
    const created = yield* service.create(definition);
    yield* service.control(control(created.workflow, "start"));
    yield* service.drain();
    h.end();
    yield* service.drain();
    const failed = yield* service.get(definition.id, threadId);
    expect(failed.workflow.status).toBe("failed");
    expect(failed.workflow.lastError).toContain("without claiming");
    expect(failed.workflow.stages[0]?.attempts).toHaveLength(0);
    const count = h.deliveries.length;
    yield* service.drain();
    expect(h.deliveries).toHaveLength(count);
  }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect("an unavailable thread does not block another workflow's dispatch", () =>
  Effect.gen(function* () {
    const h = harness();
    const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
    const created = yield* service.create(definition);
    yield* service.control(control(created.workflow, "start"));
    const otherThread = ThreadId.make("thread:other");
    const otherId = WorkflowId.make("workflow:other");
    const other = yield* service.create({ ...definition, id: otherId, threadId: otherThread });
    yield* service.control({ ...control(other.workflow, "start"), threadId: otherThread });
    h.block(threadId);
    yield* service.drain();
    expect((yield* service.get(definition.id, threadId)).workflow.status).toBe("failed");
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]?.threadId).toBe(otherThread);
  }).pipe(Effect.provide(Persistence.layerMemory)),
);

it.effect("subscribes before the initial snapshot and emits persisted changes", () =>
  Effect.gen(function* () {
    const h = harness();
    const service = yield* Workflows.WorkflowService.pipe(Effect.provide(h.layer));
    const initial = yield* Deferred.make<void>();
    const subscription = yield* service.subscribe(threadId).pipe(
      Stream.tap(() => Deferred.succeed(initial, undefined)),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(initial);
    yield* service.create(definition);
    const snapshots = yield* Fiber.join(subscription);
    expect(snapshots[0]?.workflows).toEqual([]);
    expect(snapshots[1]?.workflows[0]?.status).toBe("ready");
  }).pipe(Effect.provide(Persistence.layerMemory)),
);
