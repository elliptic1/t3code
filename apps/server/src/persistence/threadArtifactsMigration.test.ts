import { expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "./Migrations.ts";
import Workflows from "./Migrations/061_Workflows.ts";

it.effect("repairs artifact storage when fork migrations occupied IDs 61 through 63", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 60 });
    yield* Workflows;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES
      (61, 'PullRequestReviewGuides'),
      (62, 'ThreadFailureLookupIndex'),
      (63, 'Workflows')`;
    const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;

    expect(yield* runMigrations()).toEqual([[64, "EnsureThreadArtifacts"]]);
    yield* sql`INSERT INTO thread_artifacts
      (id, thread_id, name, mime_type, size_bytes, revision, storage_key, created_at, updated_at)
      VALUES ('artifact', 'thread', 'build.apk', 'application/octet-stream', 123, 0, 'bytes', '2026-10-25', '2026-10-25')`;
    expect(yield* sql`SELECT name FROM thread_artifacts`).toEqual([{ name: "build.apk" }]);
    expect(
      yield* sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_thread_artifacts_thread'`,
    ).toHaveLength(1);
    expect(
      yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id <= 63 ORDER BY migration_id`,
    ).toEqual(history);
    expect(yield* runMigrations()).toEqual([]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("preserves previously published artifacts when applying the repair", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 62 });
    yield* sql`INSERT INTO thread_artifacts
      (id, thread_id, name, mime_type, size_bytes, revision, storage_key, created_at, updated_at)
      VALUES ('artifact', 'thread', 'build.apk', 'application/octet-stream', 123, 2, 'bytes', '2026-10-25', '2026-10-25')`;
    const artifacts = yield* sql`SELECT * FROM thread_artifacts`;
    expect(yield* runMigrations()).toEqual([[64, "EnsureThreadArtifacts"]]);
    expect(yield* sql`SELECT * FROM thread_artifacts`).toEqual(artifacts);
    expect(yield* runMigrations()).toEqual([]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
