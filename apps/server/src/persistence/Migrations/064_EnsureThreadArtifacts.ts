import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Fork builds used 62 for ThreadFailureLookupIndex and 63 for Workflows,
// so their migration ledger skipped 062_ThreadArtifacts entirely.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS thread_artifacts (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_thread_artifacts_thread ON thread_artifacts(thread_id, created_at)`;
});
