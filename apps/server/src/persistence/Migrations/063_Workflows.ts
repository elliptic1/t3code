import * as Effect from "effect/Effect";
import ensureReviewGuides from "./061_PullRequestReviewGuides.ts";
import ensureFailureIndex from "./062_ThreadFailureLookupIndex.ts";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Local builds used migration 61 for workflows before upstream assigned it.
  yield* ensureReviewGuides;
  const failureIndexes = yield* sql`SELECT name FROM sqlite_master
    WHERE type = 'index' AND name = 'orchestration_v2_projection_turn_items_failed_error_idx'`;
  if (failureIndexes.length === 0) yield* ensureFailureIndex;
  // Early local builds created an older, never-used shape. Rows would need a real conversion,
  // so a non-empty old table still fails loudly on the status index below.
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(workflows)`;
  if (columns.length > 0 && !columns.some((column) => column.name === "status")) {
    const rows = yield* sql<{ readonly count: number }>`SELECT count(*) AS count FROM workflows`;
    if (rows[0]?.count === 0) {
      yield* sql`DROP TABLE IF EXISTS workflow_commands`;
      yield* sql`DROP TABLE workflows`;
    }
  }
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
