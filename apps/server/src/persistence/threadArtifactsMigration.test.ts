import { expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "./Migrations.ts";
import Workflows from "./Migrations/063_Workflows.ts";
import EnsureThreadArtifacts from "./Migrations/071_EnsureThreadArtifacts.ts";

const insertArtifact = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO thread_artifacts
    (id, thread_id, name, mime_type, size_bytes, revision, storage_key, created_at, updated_at)
    VALUES ('artifact', 'thread', 'build.apk', 'application/octet-stream', 123, 2, 'bytes', '2026-10-25', '2026-10-25')`;
  return yield* sql`SELECT * FROM thread_artifacts`;
});

const ledger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql`SELECT migration_id, name FROM effect_sql_migrations
    WHERE migration_id BETWEEN 61 AND 65 ORDER BY migration_id`;
});

const expectedLedger = [
  { migration_id: 61, name: "PullRequestReviewGuides" },
  { migration_id: 62, name: "ThreadFailureLookupIndex" },
  { migration_id: 64, name: "Workflows" },
  { migration_id: 65, name: "DropUnusedV1ProjectionsAfterForkWorkflows" },
];

it.effect("upgrades the desktop fork ledger without losing artifacts", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 62 });
    yield* Workflows;
    yield* EnsureThreadArtifacts;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES
      (63, 'Workflows'), (64, 'EnsureThreadArtifacts')`;
    const artifacts = yield* insertArtifact;

    expect((yield* runMigrations()).map(([id]) => id)).toContain(71);
    expect(yield* sql`SELECT * FROM thread_artifacts`).toEqual(artifacts);
    expect((yield* ledger).filter((row) => row.migration_id !== 63)).toEqual(expectedLedger);
    expect(yield* runMigrations()).toEqual([]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("upgrades the voice server ledger without losing artifacts", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 60 });
    // The shape real voice databases still carry, with no status column.
    yield* sql`CREATE TABLE workflows (
      workflow_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      dispatch_generation INTEGER NOT NULL DEFAULT 0,
      dispatched_generation INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`;
    yield* sql`CREATE TABLE workflow_commands (
      workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id),
      command_id TEXT NOT NULL,
      input_json TEXT NOT NULL,
      PRIMARY KEY(workflow_id, command_id)
    )`;
    yield* EnsureThreadArtifacts;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES
      (61, 'Workflows'), (62, 'ThreadArtifacts'), (64, 'EnsureThreadArtifacts')`;
    const artifacts = yield* insertArtifact;

    expect((yield* runMigrations()).map(([id]) => id)).toContain(71);
    expect(yield* sql`SELECT * FROM thread_artifacts`).toEqual(artifacts);
    expect((yield* ledger).filter((row) => row.migration_id !== 63)).toEqual(expectedLedger);
    expect(yield* runMigrations()).toEqual([]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("creates artifact storage on a new database", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();
    expect(
      yield* sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_thread_artifacts_thread'`,
    ).toHaveLength(1);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
