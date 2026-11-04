import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  APK_WORKFLOW_STAGES,
  WorkflowCreateInput,
  WorkflowId,
  workflowControls,
  type Workflow,
} from "./workflow.ts";
import { RunId, ThreadId } from "./baseSchemas.ts";

const isCreate = Schema.is(WorkflowCreateInput);

const definition = {
  id: WorkflowId.make("apk"),
  threadId: ThreadId.make("thread"),
  title: "APK",
  stages: APK_WORKFLOW_STAGES,
};

it("accepts the APK example, rejects unbounded definitions, and keeps installation separate", () => {
  expect(isCreate(definition)).toBe(true);
  expect(isCreate({ ...definition, stages: [] })).toBe(false);
  expect(
    isCreate({
      ...definition,
      stages: Array(33).fill(APK_WORKFLOW_STAGES[0]),
    }),
  ).toBe(false);
  expect(
    isCreate({
      ...definition,
      stages: [{ ...APK_WORKFLOW_STAGES[0], maxAttempts: 0 }],
    }),
  ).toBe(false);
  expect(
    isCreate({
      ...definition,
      stages: [{ ...APK_WORKFLOW_STAGES[0], maxAttempts: 11 }],
    }),
  ).toBe(false);
  expect(APK_WORKFLOW_STAGES.at(-2)?.title).toBe("Publish");
  expect(APK_WORKFLOW_STAGES.at(-1)?.title).toBe("Confirm installation");
});

it("does not offer retry or resume once the execution budget is exhausted", () => {
  const workflow: Workflow = {
    id: definition.id,
    threadId: definition.threadId,
    title: definition.title,
    status: "failed",
    revision: 0,
    lastError: null,
    createdAt: "2026-10-11T00:00:00Z",
    updatedAt: "2026-10-11T00:00:00Z",
    stages: [
      {
        ...APK_WORKFLOW_STAGES[0]!,
        status: "failed",
        maxAttempts: 1,
        attempts: [
          {
            number: 1,
            runId: RunId.make("run"),
            status: "failed",
            startedAt: "2026-10-11T00:00:00Z",
            finishedAt: "2026-10-11T00:00:00Z",
            evidence: "Failed",
          },
        ],
      },
    ],
  };
  expect(workflowControls(workflow)).toEqual(["cancel"]);
  expect(workflowControls({ ...workflow, status: "waiting" })).toEqual(["cancel"]);
  expect(workflowControls({ ...workflow, status: "paused" })).toEqual(["cancel"]);
  expect(workflowControls({ ...workflow, status: "cancelled" })).toEqual([]);
});
