import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import workflows from "./062_Workflows.ts";

it.effect.each([false, true])("preserves workflows when migration 61 was local: %s", (local) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 60 });
    if (local) {
      yield* workflows;
      yield* sql`DROP TABLE pull_request_review_guides`;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES (61, 'Workflows', CURRENT_TIMESTAMP)`;
      yield* sql`INSERT INTO workflows
        (workflow_id, thread_id, status, state_json, summary_json, updated_at)
        VALUES ('existing', 'thread', 'running', '{}', '{}', '2026-10-14')`;
    }
    yield* runMigrations();
    const tables = yield* sql<{ name: string }>`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('workflows', 'workflow_commands', 'pull_request_review_guides')
      ORDER BY name`;
    assert.deepEqual(
      tables.map((table) => table.name),
      ["pull_request_review_guides", "workflow_commands", "workflows"],
    );
    const rows = yield* sql<{ workflow_id: string }>`SELECT workflow_id FROM workflows`;
    assert.deepEqual(rows, local ? [{ workflow_id: "existing" }] : []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
