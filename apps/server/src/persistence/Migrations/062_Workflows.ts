import * as Effect from "effect/Effect";
import ensureReviewGuides from "./061_PullRequestReviewGuides.ts";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Local builds used migration 61 for workflows before upstream assigned it.
  yield* ensureReviewGuides;
  yield* sql`CREATE TABLE IF NOT EXISTS workflows (
    workflow_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    status TEXT NOT NULL,
    state_json TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    dispatch_generation INTEGER NOT NULL DEFAULT 0,
    dispatched_generation INTEGER NOT NULL DEFAULT 0,
    dispatch_run_id TEXT,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_workflows_thread ON workflows(thread_id, updated_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status)`;
  yield* sql`CREATE TABLE IF NOT EXISTS workflow_commands (
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id),
    command_id TEXT NOT NULL,
    input_json TEXT NOT NULL,
    PRIMARY KEY(workflow_id, command_id)
  )`;
});
