import {
  CommandId,
  MessageId,
  RunId,
  Workflow,
  WorkflowSummary,
  WorkflowError,
  type ThreadId,
  type WorkflowId,
  WorkflowCreateInput,
  WorkflowControlInput,
  type WorkflowReportInput,
  type WorkflowResult,
  type WorkflowListResult,
  type WorkflowClaimResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";

export class WorkflowService extends Context.Service<
  WorkflowService,
  {
    readonly list: (threadId: ThreadId) => Effect.Effect<WorkflowListResult, WorkflowError>;
    readonly get: (
      id: WorkflowId,
      threadId: ThreadId,
    ) => Effect.Effect<WorkflowResult, WorkflowError>;
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<WorkflowListResult, WorkflowError>;
    readonly create: (input: WorkflowCreateInput) => Effect.Effect<WorkflowResult, WorkflowError>;
    readonly control: (input: WorkflowControlInput) => Effect.Effect<WorkflowResult, WorkflowError>;
    readonly claim: (input: {
      id: WorkflowId;
      threadId: ThreadId;
      runId: RunId;
    }) => Effect.Effect<WorkflowClaimResult, WorkflowError>;
    readonly report: (
      input: WorkflowReportInput & { runId: RunId },
    ) => Effect.Effect<WorkflowResult, WorkflowError>;
    /** A scheduler pass; tests use it to reach durable dispatch/recovery milestones. */
    readonly drain: () => Effect.Effect<void, WorkflowError>;
  }
>()("t3/workflows/WorkflowService") {}

interface Row {
  readonly workflow_id: string;
  readonly thread_id: string;
  readonly state_json: string;
  readonly dispatch_generation: number;
  readonly dispatched_generation: number;
  readonly dispatch_run_id: string | null;
}

const isWorkflowError = Schema.is(WorkflowError);
const encodeWorkflow = Schema.encodeSync(Schema.fromJsonString(Workflow));
const encodeCreate = Schema.encodeSync(Schema.fromJsonString(WorkflowCreateInput));
const encodeControl = Schema.encodeSync(Schema.fromJsonString(WorkflowControlInput));
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Workflow));
const decodeSummary = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkflowSummary));
const encodeSummary = Schema.encodeSync(Schema.fromJsonString(WorkflowSummary));
const summarize = (workflow: Workflow): WorkflowSummary => ({
  id: workflow.id,
  threadId: workflow.threadId,
  title: workflow.title,
  status: workflow.status,
  revision: workflow.revision,
  updatedAt: workflow.updatedAt,
  lastError: workflow.lastError,
  stages: workflow.stages.map((stage) => ({
    title: stage.title,
    status: stage.status,
    attemptCount: stage.attempts.length,
    maxAttempts: stage.maxAttempts,
    latestEvidence: stage.attempts.at(-1)?.evidence?.slice(0, 500) ?? null,
  })),
});
const storageError = (cause: unknown) => new WorkflowError({ reason: "storage", cause });
const invalid = () => new WorkflowError({ reason: "invalid_transition" });
const currentIndex = (workflow: Workflow) =>
  workflow.stages.findIndex((stage) => stage.status !== "succeeded");
const terminalRun = (status: string) =>
  ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(status);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const scheduler = yield* Scheduler.Scheduler;
  const mutex = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<ThreadId>();
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const load = Effect.fn("WorkflowService.load")(function* (id: WorkflowId, threadId: ThreadId) {
    const rows =
      yield* sql<Row>`SELECT * FROM workflows WHERE workflow_id = ${id} AND thread_id = ${threadId}`.pipe(
        Effect.mapError(storageError),
      );
    const row = rows[0];
    if (row === undefined) return yield* new WorkflowError({ reason: "not_found" });
    const workflow = yield* decode(row.state_json).pipe(Effect.mapError(storageError));
    return { row, workflow };
  });
  const save = (workflow: Workflow, dispatch: boolean) =>
    sql`
    UPDATE workflows SET state_json = ${encodeWorkflow(workflow)}, summary_json = ${encodeSummary(summarize(workflow))}, status = ${workflow.status}, updated_at = ${workflow.updatedAt},
      dispatch_generation = dispatch_generation + ${dispatch ? 1 : 0}
    WHERE workflow_id = ${workflow.id}
  `.pipe(Effect.mapError(storageError), Effect.asVoid);
  const notify = (threadId: ThreadId) => PubSub.publish(changes, threadId).pipe(Effect.asVoid);
  const thread = Effect.fn("WorkflowService.thread")(function* (threadId: ThreadId) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new WorkflowError({ reason: "thread_unavailable", cause })));
    if (shell === null || shell.deletedAt !== null || shell.archivedAt !== null)
      return yield* new WorkflowError({ reason: "thread_unavailable" });
    return shell;
  });
  const list = Effect.fn("WorkflowService.list")(function* (threadId: ThreadId) {
    const rows = yield* sql<{
      summary_json: string;
    }>`SELECT summary_json FROM workflows WHERE thread_id = ${threadId} ORDER BY updated_at DESC LIMIT 50`.pipe(
      Effect.mapError(storageError),
    );
    const workflows = yield* Effect.forEach(rows, (row) =>
      decodeSummary(row.summary_json).pipe(Effect.mapError(storageError)),
    );
    return { workflows };
  });

  const create = Effect.fn("WorkflowService.create")(function* (input: WorkflowCreateInput) {
    yield* thread(input.threadId);
    const workflow = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* sql<Row>`SELECT * FROM workflows WHERE workflow_id = ${input.id}`;
          if (existing[0] !== undefined) {
            const receipts = yield* sql<{
              input_json: string;
            }>`SELECT input_json FROM workflow_commands WHERE workflow_id = ${input.id} AND command_id = 'create'`;
            if (receipts[0]?.input_json !== encodeCreate(input))
              return yield* new WorkflowError({ reason: "conflict" });
            return yield* decode(existing[0].state_json);
          }
          const timestamp = yield* now;
          const workflow: Workflow = {
            id: input.id,
            threadId: input.threadId,
            title: input.title,
            status: "ready",
            revision: 0,
            lastError: null,
            stages: input.stages.map((stage) => ({ ...stage, status: "pending", attempts: [] })),
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          yield* sql`INSERT INTO workflows ${sql.insert({ workflow_id: input.id, thread_id: input.threadId, status: workflow.status, state_json: encodeWorkflow(workflow), summary_json: encodeSummary(summarize(workflow)), updated_at: timestamp })}`;
          yield* sql`INSERT INTO workflow_commands ${sql.insert({ workflow_id: input.id, command_id: "create", input_json: encodeCreate(input) })}`;
          return workflow;
        }),
      )
      .pipe(Effect.mapError((cause) => (isWorkflowError(cause) ? cause : storageError(cause))));
    yield* notify(input.threadId);
    return { workflow };
  }, mutex.withPermits(1));

  const control = Effect.fn("WorkflowService.control")(function* (input: WorkflowControlInput) {
    const workflow = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const { workflow } = yield* load(input.id, input.threadId);
          const receipts = yield* sql<{
            input_json: string;
          }>`SELECT input_json FROM workflow_commands WHERE workflow_id = ${input.id} AND command_id = ${input.commandId}`;
          if (receipts[0] !== undefined) {
            if (receipts[0].input_json !== encodeControl(input))
              return yield* new WorkflowError({ reason: "conflict" });
            return workflow;
          }
          if (workflow.revision !== input.expectedRevision)
            return yield* new WorkflowError({ reason: "conflict" });
          if (["succeeded", "cancelled"].includes(workflow.status)) return yield* invalid();
          const index = currentIndex(workflow);
          const stage = workflow.stages[index];
          let status: Workflow["status"];
          let stages = workflow.stages;
          switch (input.action) {
            case "start":
              if (workflow.status !== "ready") return yield* invalid();
              yield* thread(input.threadId);
              status = "running";
              break;
            case "pause":
              if (workflow.status !== "running") return yield* invalid();
              status = "paused";
              break;
            case "cancel": {
              status = "cancelled";
              const timestamp = yield* now;
              stages = workflow.stages.map((stage) =>
                stage.status === "succeeded"
                  ? stage
                  : {
                      ...stage,
                      status: "cancelled",
                      attempts: stage.attempts.map((attempt) =>
                        attempt.status !== "running"
                          ? attempt
                          : {
                              ...attempt,
                              status: "cancelled",
                              finishedAt: timestamp,
                              evidence:
                                "The workflow was cancelled. External work already executing may still finish.",
                            },
                      ),
                    },
              );
              break;
            }
            case "retry":
            case "resume": {
              if (
                input.action === "retry"
                  ? workflow.status !== "failed"
                  : !["paused", "waiting"].includes(workflow.status)
              )
                return yield* invalid();
              yield* thread(input.threadId);
              if (stage !== undefined && ["failed", "waiting"].includes(stage.status)) {
                if (stage.attempts.length >= stage.maxAttempts)
                  return yield* new WorkflowError({ reason: "attempt_limit" });
                stages = workflow.stages.map((value, i) =>
                  i === index ? { ...value, status: "pending" as const } : value,
                );
              }
              status = index === -1 ? "succeeded" : "running";
              break;
            }
          }
          const updated: Workflow = {
            ...workflow,
            stages,
            status,
            lastError: status === "running" ? null : workflow.lastError,
            revision: workflow.revision + 1,
            updatedAt: yield* now,
          };
          const needsDispatch = status === "running" && stages[index]?.status === "pending";
          yield* save(updated, needsDispatch);
          yield* sql`INSERT INTO workflow_commands ${sql.insert({ workflow_id: input.id, command_id: input.commandId, input_json: encodeControl(input) })}`;
          return updated;
        }),
      )
      .pipe(Effect.mapError((cause) => (isWorkflowError(cause) ? cause : storageError(cause))));
    yield* notify(input.threadId);
    return { workflow };
  }, mutex.withPermits(1));

  const claim = Effect.fn("WorkflowService.claim")(function* (input: {
    id: WorkflowId;
    threadId: ThreadId;
    runId: RunId;
  }) {
    const result = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const { workflow } = yield* load(input.id, input.threadId);
          const shell = yield* thread(input.threadId);
          if (shell.activeRunId !== input.runId || workflow.status !== "running")
            return yield* invalid();
          const index = currentIndex(workflow);
          const stage = workflow.stages[index];
          if (stage === undefined) return yield* invalid();
          const previous = stage.attempts.at(-1);
          if (stage.status === "running" && previous?.runId === input.runId)
            return { workflow, stageIndex: index, attempt: previous.number };
          if (stage.status !== "pending") return yield* invalid();
          if (stage.attempts.length >= stage.maxAttempts)
            return yield* new WorkflowError({ reason: "attempt_limit" });
          const timestamp = yield* now;
          const attempt = stage.attempts.length + 1;
          const updated: Workflow = {
            ...workflow,
            revision: workflow.revision + 1,
            updatedAt: timestamp,
            stages: workflow.stages.map((value, i) =>
              i === index
                ? {
                    ...value,
                    status: "running",
                    attempts: [
                      ...value.attempts,
                      {
                        number: attempt,
                        runId: input.runId,
                        status: "running",
                        startedAt: timestamp,
                        finishedAt: null,
                        evidence: null,
                      },
                    ],
                  }
                : value,
            ),
          };
          yield* save(updated, false);
          return { workflow: updated, stageIndex: index, attempt };
        }),
      )
      .pipe(Effect.mapError((cause) => (isWorkflowError(cause) ? cause : storageError(cause))));
    yield* notify(input.threadId);
    return result;
  }, mutex.withPermits(1));

  const report = Effect.fn("WorkflowService.report")(function* (
    input: WorkflowReportInput & { runId: RunId },
  ) {
    const workflow = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const { workflow } = yield* load(input.id, input.threadId);
          if (workflow.status === "cancelled") return yield* invalid();
          const stage = workflow.stages[input.stageIndex];
          const attempt = stage?.attempts.at(-1);
          if (
            stage === undefined ||
            attempt === undefined ||
            attempt.number !== input.attempt ||
            attempt.runId !== input.runId
          )
            return yield* new WorkflowError({ reason: "conflict" });
          if (attempt.status === input.status && attempt.evidence === input.evidence)
            return workflow;
          if (attempt.status !== "running" || currentIndex(workflow) !== input.stageIndex)
            return yield* invalid();
          const shell = yield* thread(input.threadId);
          if (shell.activeRunId !== input.runId) return yield* invalid();
          const timestamp = yield* now;
          const stages = workflow.stages.map((value, i) =>
            i === input.stageIndex
              ? {
                  ...value,
                  status: input.status,
                  attempts: value.attempts.map((value) =>
                    value.number === input.attempt
                      ? {
                          ...value,
                          status: input.status,
                          evidence: input.evidence,
                          finishedAt: timestamp,
                        }
                      : value,
                  ),
                }
              : value,
          );
          const status =
            workflow.status === "paused"
              ? "paused"
              : input.status === "succeeded"
                ? stages.every((stage) => stage.status === "succeeded")
                  ? "succeeded"
                  : "running"
                : input.status;
          const updated: Workflow = {
            ...workflow,
            stages,
            status,
            revision: workflow.revision + 1,
            updatedAt: timestamp,
          };
          yield* save(updated, status === "running");
          return updated;
        }),
      )
      .pipe(Effect.mapError((cause) => (isWorkflowError(cause) ? cause : storageError(cause))));
    yield* notify(input.threadId);
    return { workflow };
  }, mutex.withPermits(1));

  const drain = Effect.fn("WorkflowService.drain")(function* () {
    const rows =
      yield* sql<Row>`SELECT * FROM workflows WHERE status IN ('running', 'paused')`.pipe(
        Effect.mapError(storageError),
      );
    for (const row of rows) {
      yield* Effect.gen(function* () {
        const workflow = yield* decode(row.state_json).pipe(Effect.mapError(storageError));
        const index = currentIndex(workflow);
        const stage = workflow.stages[index];
        const attempt = stage?.attempts.at(-1);
        if (
          workflow.status === "running" &&
          stage?.status === "pending" &&
          row.dispatch_generation === row.dispatched_generation &&
          row.dispatch_run_id !== null
        ) {
          const dispatchedRunId = RunId.make(row.dispatch_run_id);
          const projection = yield* threads
            .getThreadRecords(workflow.threadId, ["runs"], { runIds: [dispatchedRunId] })
            .pipe(
              Effect.mapError(
                (cause) => new WorkflowError({ reason: "thread_unavailable", cause }),
              ),
            );
          const run = projection.runs.find((run) => run.id === dispatchedRunId);
          if (run === undefined || terminalRun(run.status)) {
            yield* save(
              {
                ...workflow,
                status: "failed",
                lastError:
                  "The agent turn ended without claiming this stage. Check that the provider can use workflow tools, then retry.",
                revision: workflow.revision + 1,
                updatedAt: yield* now,
              },
              false,
            );
            yield* notify(workflow.threadId);
            return;
          }
        }
        if (stage?.status === "running" && attempt !== undefined) {
          const projection = yield* threads
            .getThreadRecords(workflow.threadId, ["runs"], { runIds: [attempt.runId] })
            .pipe(
              Effect.mapError(
                (cause) => new WorkflowError({ reason: "thread_unavailable", cause }),
              ),
            );
          const run = projection.runs.find((run) => run.id === attempt.runId);
          if (run === undefined || terminalRun(run.status)) {
            const timestamp = yield* now;
            const updated: Workflow = {
              ...workflow,
              status: workflow.status === "paused" ? "paused" : "failed",
              revision: workflow.revision + 1,
              updatedAt: timestamp,
              stages: workflow.stages.map((value, i) =>
                i === index
                  ? {
                      ...value,
                      status: "failed",
                      attempts: value.attempts.map((value) =>
                        value.number === attempt.number
                          ? {
                              ...value,
                              status: "failed",
                              finishedAt: timestamp,
                              evidence:
                                "The agent turn ended without reporting a stage result. Inspect existing effects before retrying.",
                            }
                          : value,
                      ),
                    }
                  : value,
              ),
            };
            yield* save(updated, false);
            yield* notify(workflow.threadId);
          }
        }
        if (
          row.dispatch_generation <= row.dispatched_generation ||
          workflow.status !== "running" ||
          stage?.status !== "pending"
        )
          return;
        const shell = yield* thread(workflow.threadId);
        const priorEvidence = workflow.stages
          .slice(0, index)
          .map((stage) => `${stage.title}: ${stage.attempts.at(-1)?.evidence?.slice(0, 700) ?? ""}`)
          .join("\n");
        // The generation is committed before sending. Replaying this command after
        // a crash reuses orchestration's receipt rather than creating another turn.
        const key = `workflow:${workflow.id}:${row.dispatch_generation}`;
        const sent = yield* threads
          .sendToThread({
            projectId: shell.projectId,
            threadId: workflow.threadId,
            commandId: CommandId.make(key),
            messageId: MessageId.make(key),
            mode: "queue",
            attachments: [],
            createdBy: "system",
            creationSource: "server",
            text: `Run one stage of workflow ${workflow.id} (${workflow.title}). First call workflow_claim with id and this threadId. If claiming is refused, do no stage work. Execute ONLY the returned stage. Inspect any previous attempts before repeating effects. Report through workflow_report with the returned stageIndex and attempt, a status of succeeded, failed, or waiting, and concrete evidence addressing its success criteria. End this turn after reporting; T3 queues the next stage. Do not treat a successful agent turn as proof that a stage passed.\n\nStage: ${stage.title}\nInstruction: ${stage.instruction}\nSuccess criteria: ${stage.successCriteria}\n\nPrior completed stages:\n${priorEvidence}`,
          })
          .pipe(
            Effect.mapError((cause) => new WorkflowError({ reason: "thread_unavailable", cause })),
          );
        yield* sql`UPDATE workflows SET dispatched_generation = ${row.dispatch_generation}, dispatch_run_id = ${sent.run.id} WHERE workflow_id = ${workflow.id}`.pipe(
          Effect.mapError(storageError),
        );
      }).pipe(
        Effect.catchTags({
          WorkflowError: (error) =>
            Effect.gen(function* () {
              // One inaccessible thread must not prevent unrelated workflows from progressing.
              if (error.reason === "thread_unavailable") {
                const { workflow } = yield* load(
                  row.workflow_id as WorkflowId,
                  row.thread_id as ThreadId,
                );
                if (
                  workflow.status === "running" &&
                  workflow.stages[currentIndex(workflow)]?.status === "pending"
                ) {
                  yield* save(
                    {
                      ...workflow,
                      status: "failed",
                      lastError:
                        "Could not queue this stage. Restore access to the thread, then retry.",
                      revision: workflow.revision + 1,
                      updatedAt: yield* now,
                    },
                    false,
                  );
                  yield* notify(workflow.threadId);
                }
              }
              yield* Effect.logWarning("Workflow scheduler pass could not process a workflow", {
                reason: error.reason,
              });
            }),
        }),
      );
    }
  }, mutex.withPermits(1));

  yield* scheduler.register("workflows", drain());
  return WorkflowService.of({
    list,
    get: (id, threadId) => load(id, threadId).pipe(Effect.map(({ workflow }) => ({ workflow }))),
    create,
    control,
    claim,
    report,
    drain,
    subscribe: (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(list(threadId)),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((id) => id === threadId),
              Stream.mapEffect(() => list(threadId)),
            ),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(WorkflowService, make);
