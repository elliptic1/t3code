import * as Schema from "effect/Schema";
import { CommandId, IsoDateTime, RunId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorkflowId = TrimmedNonEmptyString.pipe(Schema.brand("WorkflowId"));
export type WorkflowId = typeof WorkflowId.Type;

const WorkflowText = TrimmedNonEmptyString.check(Schema.isMaxLength(16_000));
export const WorkflowStageDefinition = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  instruction: WorkflowText,
  successCriteria: WorkflowText,
  maxAttempts: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
});
export type WorkflowStageDefinition = typeof WorkflowStageDefinition.Type;

export const WorkflowAttempt = Schema.Struct({
  number: Schema.Int,
  runId: RunId,
  status: Schema.Literals(["running", "succeeded", "failed", "waiting", "cancelled"]),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  evidence: Schema.NullOr(WorkflowText),
});
export type WorkflowAttempt = typeof WorkflowAttempt.Type;

export const WorkflowStage = Schema.Struct({
  ...WorkflowStageDefinition.fields,
  status: Schema.Literals(["pending", "running", "succeeded", "failed", "waiting", "cancelled"]),
  attempts: Schema.Array(WorkflowAttempt),
});

export const Workflow = Schema.Struct({
  id: WorkflowId,
  threadId: ThreadId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  status: Schema.Literals([
    "ready",
    "running",
    "paused",
    "waiting",
    "failed",
    "succeeded",
    "cancelled",
  ]),
  revision: Schema.Int,
  lastError: Schema.NullOr(Schema.String),
  stages: Schema.Array(WorkflowStage),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Workflow = typeof Workflow.Type;

export const WorkflowListInput = Schema.Struct({ threadId: ThreadId });
/** Subscriptions carry stage summaries; full instructions and attempt history load on demand. */
export const WorkflowSummary = Schema.Struct({
  id: WorkflowId,
  threadId: ThreadId,
  title: Workflow.fields.title,
  status: Workflow.fields.status,
  revision: Schema.Int,
  updatedAt: IsoDateTime,
  lastError: Schema.NullOr(Schema.String),
  stages: Schema.Array(
    Schema.Struct({
      title: WorkflowStageDefinition.fields.title,
      status: WorkflowStage.fields.status,
      attemptCount: Schema.Int,
      maxAttempts: WorkflowStageDefinition.fields.maxAttempts,
      latestEvidence: Schema.NullOr(Schema.String),
    }),
  ),
});
export type WorkflowSummary = typeof WorkflowSummary.Type;
export const WorkflowListResult = Schema.Struct({ workflows: Schema.Array(WorkflowSummary) });
export type WorkflowListResult = typeof WorkflowListResult.Type;
export const WorkflowCreateInput = Schema.Struct({
  id: WorkflowId,
  threadId: ThreadId,
  title: Workflow.fields.title,
  stages: Schema.Array(WorkflowStageDefinition).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
  ),
});
export type WorkflowCreateInput = typeof WorkflowCreateInput.Type;

export const WorkflowControlInput = Schema.Struct({
  id: WorkflowId,
  threadId: ThreadId,
  commandId: CommandId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  action: Schema.Literals(["start", "pause", "resume", "retry", "cancel"]),
});
export type WorkflowControlInput = typeof WorkflowControlInput.Type;

/** Execution tools bind the run ID on the server, rather than trusting the agent. */
export const WorkflowClaimInput = Schema.Struct({ id: WorkflowId, threadId: ThreadId });
export const WorkflowGetInput = Schema.Struct({
  ...WorkflowClaimInput.fields,
  revision: Schema.optional(Schema.Int),
});
export const WorkflowReportInput = Schema.Struct({
  id: WorkflowId,
  threadId: ThreadId,
  stageIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  status: Schema.Literals(["succeeded", "failed", "waiting"]),
  evidence: WorkflowText,
});
export type WorkflowReportInput = typeof WorkflowReportInput.Type;
export const WorkflowResult = Schema.Struct({ workflow: Workflow });
export type WorkflowResult = typeof WorkflowResult.Type;
export const WorkflowClaimResult = Schema.Struct({
  workflow: Workflow,
  stageIndex: Schema.Int,
  attempt: Schema.Int,
});
export type WorkflowClaimResult = typeof WorkflowClaimResult.Type;

export class WorkflowError extends Schema.TaggedError<WorkflowError>()("WorkflowError", {
  reason: Schema.Literals([
    "not_found",
    "conflict",
    "invalid_transition",
    "attempt_limit",
    "storage",
    "thread_unavailable",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not_found":
        return "The workflow was not found in this thread.";
      case "conflict":
        return "The workflow changed. Refresh its state before trying again.";
      case "invalid_transition":
        return "This action is not available in the workflow's current state.";
      case "attempt_limit":
        return "This stage has reached its attempt limit.";
      case "thread_unavailable":
        return "The workflow's thread is unavailable.";
      case "storage":
        return "The workflow could not be saved or loaded.";
    }
  }
}

/** Offered as a draft; never starts a build or changes a repository by itself. */
export const APK_WORKFLOW_STAGES: readonly WorkflowStageDefinition[] = [
  {
    title: "Sync upstream",
    instruction:
      "Fetch upstream and fork refs without changing the checkout. Record the upstream and fork commit IDs.",
    successCriteria: "Both refs were fetched successfully and their exact commit IDs are recorded.",
    maxAttempts: 3,
  },
  {
    title: "Integrate fork",
    instruction:
      "Integrate the recorded upstream commit into the fork, preserving fork changes. Stop on conflicts that require a decision. Record the resulting source commit.",
    successCriteria:
      "Integration is committed, fork changes are preserved, and the source commit is recorded.",
    maxAttempts: 3,
  },
  {
    title: "Check",
    instruction:
      "Run focused checks appropriate to the integrated changes and Android build. Record the commands and outcomes. Do not run repository-wide checks unless authorized.",
    successCriteria: "The relevant checks pass against the recorded source commit.",
    maxAttempts: 3,
  },
  {
    title: "Build APK",
    instruction:
      "Build the fork's Android APK using its existing build and signing configuration. Record source commit, APK path, SHA-256, and signing certificate fingerprint. Do not expose credentials.",
    successCriteria:
      "The build passed and the APK's source, file hash, and signing identity are recorded.",
    maxAttempts: 3,
  },
  {
    title: "Verify APK",
    instruction:
      "Verify package identity, signing certificate, source commit, and APK SHA-256 against the build evidence. Inspect the actual artifact.",
    successCriteria:
      "The artifact matches the intended fork, source commit, package, and signing certificate.",
    maxAttempts: 2,
  },
  {
    title: "Publish",
    instruction:
      "Push the verified source commit to the fork and publish the verified APK through the existing release path. Verify the downloaded artifact's hash. Record the release link. Do not install through adb.",
    successCriteria:
      "Fork source is pushed, the release is reachable, and the downloaded APK hash matches the verified artifact.",
    maxAttempts: 3,
  },
  {
    title: "Confirm installation",
    instruction:
      "Provide the release download link for manual installation. Report waiting until the user confirms installation or device evidence verifies the installed artifact. Publication alone is not installation. Do not install through adb.",
    successCriteria:
      "The user confirmed installation of this release, or device evidence verified the installed artifact.",
    maxAttempts: 3,
  },
];

export function workflowControls(
  workflow: Workflow | WorkflowSummary,
): readonly WorkflowControlInput["action"][] {
  switch (workflow.status) {
    case "ready":
      return ["start", "cancel"];
    case "running":
      return ["pause", "cancel"];
    case "paused":
    case "waiting":
      return [
        ...(workflow.stages.some(
          (stage) =>
            ["waiting", "failed"].includes(stage.status) &&
            ("attemptCount" in stage ? stage.attemptCount : stage.attempts.length) >=
              stage.maxAttempts,
        )
          ? []
          : ["resume" as const]),
        "cancel",
      ];
    case "failed":
      return [
        ...(workflow.stages.some(
          (stage) =>
            ["failed", "pending"].includes(stage.status) &&
            ("attemptCount" in stage ? stage.attemptCount : stage.attempts.length) <
              stage.maxAttempts,
        )
          ? ["retry" as const]
          : []),
        "cancel",
      ];
    case "succeeded":
    case "cancelled":
      return [];
  }
}
