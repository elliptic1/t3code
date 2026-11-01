import {
  THREAD_ARTIFACT_MAX_BYTES,
  ThreadArtifact,
  ThreadArtifactError,
  ThreadArtifactUploadInput,
  type ThreadArtifactPublishInput,
  type ThreadArtifactRenameInput,
  type ThreadArtifactChangeInput,
  type ThreadArtifactListResult,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import { openMediaFile, streamMediaFile } from "../assets/MediaFile.ts";

export const ARTIFACT_ROUTE_PREFIX = "/api/thread-artifacts";
const TOKEN_TTL_MS = 60 * 60_000;
const UploadClaims = Schema.Struct({
  kind: Schema.Literal("thread-artifact-upload"),
  input: ThreadArtifactUploadInput,
  id: ThreadArtifact.fields.id,
  expiresAt: Schema.Number,
});
const DownloadClaims = Schema.Struct({
  kind: Schema.Literal("thread-artifact-download"),
  threadId: ThreadArtifact.fields.threadId,
  id: ThreadArtifact.fields.id,
  revision: ThreadArtifact.fields.revision,
  expiresAt: Schema.Number,
});
const Claims = Schema.Union([UploadClaims, DownloadClaims]);
const decodeClaims = Schema.decodeUnknownEffect(Schema.fromJsonString(Claims));
const encodeClaims = Schema.encodeSync(Schema.fromJsonString(Claims));
type UploadClaims = typeof UploadClaims.Type;
type Row = {
  id: string;
  thread_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  revision: number;
  storage_key: string;
  created_at: string;
  updated_at: string;
};
const metadata = (row: Row): ThreadArtifact => ({
  id: row.id,
  threadId: row.thread_id as ThreadId,
  name: row.name,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const storageError = (cause: unknown) => new ThreadArtifactError({ reason: "storage", cause });
const isArtifactError = Schema.is(ThreadArtifactError);
const mapError = (cause: unknown) => (isArtifactError(cause) ? cause : storageError(cause));
type UrlResult = { readonly relativeUrl: string; readonly expiresAt: number };

export class ThreadArtifactService extends Context.Service<
  ThreadArtifactService,
  {
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ThreadArtifactListResult, ThreadArtifactError>;
    readonly subscribe: (
      threadId: ThreadId,
    ) => Stream.Stream<ThreadArtifactListResult, ThreadArtifactError>;
    readonly publish: (
      input: ThreadArtifactPublishInput,
    ) => Effect.Effect<{ artifact: ThreadArtifact }, ThreadArtifactError>;
    readonly rename: (
      input: ThreadArtifactRenameInput,
    ) => Effect.Effect<{ artifact: ThreadArtifact }, ThreadArtifactError>;
    readonly remove: (input: ThreadArtifactChangeInput) => Effect.Effect<void, ThreadArtifactError>;
    readonly createUploadUrl: (
      input: ThreadArtifactUploadInput,
    ) => Effect.Effect<UrlResult, ThreadArtifactError>;
    readonly upload: (
      token: string,
      body: HttpServerRequest.HttpServerRequest["stream"],
    ) => Effect.Effect<void, ThreadArtifactError>;
    readonly createDownloadUrl: (input: {
      threadId: ThreadId;
      id: string;
    }) => Effect.Effect<UrlResult, ThreadArtifactError>;
    readonly resolveDownload: (
      token: string,
    ) => Effect.Effect<
      { path: string; download: true; fileName: string; mimeType: string },
      ThreadArtifactError
    >;
    /** Called by thread deletion's durable cleanup effect; settling retains artifacts. */
    readonly cleanupDeletedThread: (threadId: string) => Effect.Effect<void, ThreadArtifactError>;
  }
>()("t3/artifacts/ThreadArtifactService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;
  const mutex = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<ThreadId>();
  const root = path.join(config.stateDir, "thread-artifacts");
  yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.mapError(storageError));
  const filePath = (key: string) => path.join(root, key);
  const uuid = crypto.randomUUIDv4().pipe(Effect.mapError(storageError));
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const notify = (id: ThreadId) => PubSub.publish(changes, id).pipe(Effect.asVoid);
  const discard = (key: string) =>
    fs
      .remove(filePath(key), { force: true })
      .pipe(
        Effect.catch((cause) => Effect.logWarning("Could not remove artifact bytes", { cause })),
      );
  const assertThread = Effect.fn("ThreadArtifactService.assertThread")(function* (
    threadId: ThreadId,
  ) {
    const rows = yield* sql<{
      deleted_at: string | null;
    }>`SELECT deleted_at FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId}`.pipe(
      Effect.mapError(storageError),
    );
    if (!rows[0] || rows[0].deleted_at !== null)
      return yield* new ThreadArtifactError({ reason: "thread_unavailable" });
  });
  const load = Effect.fn("ThreadArtifactService.load")(function* (threadId: ThreadId, id: string) {
    yield* assertThread(threadId);
    const rows =
      yield* sql<Row>`SELECT * FROM thread_artifacts WHERE thread_id = ${threadId} AND id = ${id}`.pipe(
        Effect.mapError(storageError),
      );
    if (!rows[0]) return yield* new ThreadArtifactError({ reason: "not_found" });
    return rows[0];
  });
  const list = Effect.fn("ThreadArtifactService.list")(function* (threadId: ThreadId) {
    yield* assertThread(threadId);
    const rows =
      yield* sql<Row>`SELECT * FROM thread_artifacts WHERE thread_id = ${threadId} ORDER BY created_at, id`.pipe(
        Effect.mapError(storageError),
      );
    return { artifacts: rows.map(metadata) };
  });
  const checkReplacement = Effect.fn("ThreadArtifactService.checkReplacement")(function* (
    input: ThreadArtifactUploadInput,
  ) {
    yield* assertThread(input.threadId);
    if (!input.replace) return null;
    const row = yield* load(input.threadId, input.replace.id);
    if (row.revision !== input.replace.expectedRevision)
      return yield* new ThreadArtifactError({ reason: "conflict" });
    return row;
  });
  const sign = Effect.fn("ThreadArtifactService.sign")(function* (
    claims: typeof Claims.Type,
    route: string,
  ) {
    const secret = yield* secrets
      .getOrCreateRandom("thread-artifact-signing-key", 32)
      .pipe(Effect.mapError(storageError));
    const payload = base64UrlEncode(encodeClaims(claims));
    return {
      relativeUrl: `${ARTIFACT_ROUTE_PREFIX}/${route}/${payload}.${signPayload(payload, secret)}`,
      expiresAt: claims.expiresAt,
    };
  });
  const verify = Effect.fn("ThreadArtifactService.verify")(function* (token: string) {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra)
      return yield* new ThreadArtifactError({ reason: "invalid_upload" });
    const secret = yield* secrets
      .getOrCreateRandom("thread-artifact-signing-key", 32)
      .pipe(Effect.mapError(storageError));
    if (!timingSafeEqualBase64Url(signature, signPayload(payload, secret)))
      return yield* new ThreadArtifactError({ reason: "invalid_upload" });
    const claims = yield* Effect.try({
      try: () => base64UrlDecodeUtf8(payload),
      catch: () => new ThreadArtifactError({ reason: "invalid_upload" }),
    }).pipe(
      Effect.flatMap(decodeClaims),
      Effect.mapError(() => new ThreadArtifactError({ reason: "invalid_upload" })),
    );
    if (claims.expiresAt <= (yield* Clock.currentTimeMillis))
      return yield* new ThreadArtifactError({ reason: "invalid_upload" });
    return claims;
  });

  // Transfers happen outside the mutex. Only publishing the finished file and metadata is serialized.
  const commit = Effect.fn("ThreadArtifactService.commit")(function* (
    claims: UploadClaims,
    storageKey: string,
  ) {
    const artifact = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const previous = yield* checkReplacement(claims.input);
          const existing = yield* sql`SELECT id FROM thread_artifacts WHERE id = ${claims.id}`;
          if (!previous && existing.length > 0)
            return yield* new ThreadArtifactError({ reason: "conflict" });
          const timestamp = yield* now;
          const row: Row = {
            id: previous?.id ?? claims.id,
            thread_id: claims.input.threadId,
            name: claims.input.name,
            mime_type: claims.input.mimeType,
            size_bytes: claims.input.sizeBytes,
            revision: previous ? previous.revision + 1 : 0,
            storage_key: storageKey,
            created_at: previous?.created_at ?? timestamp,
            updated_at: timestamp,
          };
          if (previous) {
            yield* sql`UPDATE thread_artifacts SET name = ${row.name}, mime_type = ${row.mime_type}, size_bytes = ${row.size_bytes}, revision = ${row.revision}, storage_key = ${storageKey}, updated_at = ${timestamp} WHERE id = ${row.id}`;
          } else {
            yield* sql`INSERT INTO thread_artifacts ${sql.insert(row)}`;
          }
          return { artifact: metadata(row), previous };
        }),
      )
      .pipe(Effect.mapError(mapError));
    if (artifact.previous) yield* discard(artifact.previous.storage_key);
    yield* notify(claims.input.threadId);
    return { artifact: artifact.artifact };
  }, mutex.withPermits(1));

  const store = Effect.fn("ThreadArtifactService.store")(function* <E>(
    claims: UploadClaims,
    body: Stream.Stream<Uint8Array, E>,
  ) {
    const key = yield* uuid;
    let received = 0;
    let committed = false;
    return yield* Effect.gen(function* () {
      yield* Stream.run(
        body.pipe(
          Stream.takeWhile((chunk) => {
            received += chunk.byteLength;
            return received <= claims.input.sizeBytes;
          }),
        ),
        fs.sink(filePath(key)),
      ).pipe(Effect.mapError(storageError));
      if (received !== claims.input.sizeBytes)
        return yield* new ThreadArtifactError({ reason: "invalid_upload" });
      // Once metadata commits, cancellation must not remove its newly published bytes.
      return yield* Effect.uninterruptible(
        commit(claims, key).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              committed = true;
            }),
          ),
        ),
      );
    }).pipe(Effect.ensuring(Effect.suspend(() => (committed ? Effect.void : discard(key)))));
  });
  const publish = Effect.fn("ThreadArtifactService.publish")(function* (
    input: ThreadArtifactPublishInput,
  ) {
    yield* assertThread(input.threadId);
    if (!path.isAbsolute(input.sourcePath))
      return yield* new ThreadArtifactError({ reason: "invalid_file" });
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fs
          .realPath(input.sourcePath)
          .pipe(
            Effect.mapError((cause) => new ThreadArtifactError({ reason: "invalid_file", cause })),
          );
        const file = yield* openMediaFile(source).pipe(
          Effect.mapError((cause) => new ThreadArtifactError({ reason: "invalid_file", cause })),
        );
        if (!file) return yield* new ThreadArtifactError({ reason: "invalid_file" });
        if (file.info.size > BigInt(THREAD_ARTIFACT_MAX_BYTES))
          return yield* new ThreadArtifactError({ reason: "too_large" });
        const bytes =
          file.info.size === 0n ? Stream.empty : streamMediaFile(file, 0n, file.info.size);
        if (!bytes) return yield* new ThreadArtifactError({ reason: "invalid_file" });
        return yield* store(
          {
            kind: "thread-artifact-upload",
            id: input.replace?.id ?? (yield* uuid),
            expiresAt: 0,
            input: {
              threadId: input.threadId,
              name: input.name,
              mimeType: input.mimeType,
              sizeBytes: Number(file.info.size),
              ...(input.replace ? { replace: input.replace } : {}),
            },
          },
          bytes,
        );
      }),
    );
  });
  const rename = Effect.fn("ThreadArtifactService.rename")(function* (
    input: ThreadArtifactRenameInput,
  ) {
    const row = yield* load(input.threadId, input.id);
    if (row.revision !== input.expectedRevision)
      return yield* new ThreadArtifactError({ reason: "conflict" });
    const timestamp = yield* now;
    yield* sql`UPDATE thread_artifacts SET name = ${input.name}, revision = revision + 1, updated_at = ${timestamp} WHERE id = ${input.id}`.pipe(
      Effect.mapError(storageError),
    );
    yield* notify(input.threadId);
    return {
      artifact: metadata({
        ...row,
        name: input.name,
        revision: row.revision + 1,
        updated_at: timestamp,
      }),
    };
  }, mutex.withPermits(1));
  const remove = Effect.fn("ThreadArtifactService.remove")(function* (
    input: ThreadArtifactChangeInput,
  ) {
    const row = yield* load(input.threadId, input.id);
    if (row.revision !== input.expectedRevision)
      return yield* new ThreadArtifactError({ reason: "conflict" });
    yield* sql`DELETE FROM thread_artifacts WHERE id = ${input.id}`.pipe(
      Effect.mapError(storageError),
    );
    yield* discard(row.storage_key);
    yield* notify(input.threadId);
  }, mutex.withPermits(1));
  return ThreadArtifactService.of({
    list,
    publish,
    rename,
    remove,
    subscribe: (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const queue = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(list(threadId)),
            Stream.fromSubscription(queue).pipe(
              Stream.filter((id) => id === threadId),
              Stream.mapEffect(() => list(threadId)),
            ),
          );
        }),
      ),
    createUploadUrl: Effect.fn("ThreadArtifactService.createUploadUrl")(function* (input) {
      yield* checkReplacement(input);
      return yield* sign(
        {
          kind: "thread-artifact-upload",
          input,
          id: input.replace?.id ?? (yield* uuid),
          expiresAt: (yield* Clock.currentTimeMillis) + TOKEN_TTL_MS,
        },
        "upload",
      );
    }),
    upload: Effect.fn("ThreadArtifactService.upload")(function* (token, body) {
      const claims = yield* verify(token);
      if (claims.kind !== "thread-artifact-upload")
        return yield* new ThreadArtifactError({ reason: "invalid_upload" });
      yield* store(claims, body);
    }),
    createDownloadUrl: Effect.fn("ThreadArtifactService.createDownloadUrl")(function* (input) {
      const row = yield* load(input.threadId, input.id);
      return yield* sign(
        {
          kind: "thread-artifact-download",
          threadId: input.threadId,
          id: input.id,
          revision: row.revision,
          expiresAt: (yield* Clock.currentTimeMillis) + TOKEN_TTL_MS,
        },
        "download",
      );
    }),
    resolveDownload: Effect.fn("ThreadArtifactService.resolveDownload")(function* (token) {
      const claims = yield* verify(token);
      if (claims.kind !== "thread-artifact-download")
        return yield* new ThreadArtifactError({ reason: "not_found" });
      const row = yield* load(claims.threadId, claims.id);
      if (row.revision !== claims.revision)
        return yield* new ThreadArtifactError({ reason: "not_found" });
      return {
        path: filePath(row.storage_key),
        download: true,
        fileName: row.name,
        mimeType: row.mime_type,
      };
    }),
    cleanupDeletedThread: Effect.fn("ThreadArtifactService.cleanupDeletedThread")(function* (
      threadId,
    ) {
      const shell = yield* sql<{
        deleted_at: string | null;
      }>`SELECT deleted_at FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId}`.pipe(
        Effect.mapError(storageError),
      );
      if (shell[0]?.deleted_at === null) return;
      const rows =
        yield* sql<Row>`SELECT * FROM thread_artifacts WHERE thread_id = ${threadId}`.pipe(
          Effect.mapError(storageError),
        );
      yield* sql`DELETE FROM thread_artifacts WHERE thread_id = ${threadId}`.pipe(
        Effect.mapError(storageError),
      );
      yield* Effect.forEach(rows, (row) => discard(row.storage_key), { discard: true });
    }, mutex.withPermits(1)),
  });
});

export const layer = Layer.effect(ThreadArtifactService, make);
