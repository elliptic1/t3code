import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  ThreadId,
  THREAD_ARTIFACT_MAX_BYTES,
  ThreadArtifactRpcGroup,
  WS_METHODS,
  AuthFilesystemReadScope,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as RpcTest from "effect/rpc/RpcTest";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Persistence from "../persistence/Sqlite.ts";
import * as Artifacts from "./ThreadArtifactService.ts";
import { layerArtifactDownloadRoute, layerArtifactUploadRoute } from "../http.ts";
import * as ArtifactRpc from "./rpc.ts";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { rpcInstrumentationLayer } from "../observability/RpcInstrumentation.ts";

const threadId = ThreadId.make("artifact-thread");
const otherThread = ThreadId.make("other-thread");
const layer = Artifacts.layer.pipe(
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(Persistence.layerMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-artifacts-" })),
  Layer.provideMerge(NodeServices.layer),
);
const setup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  for (const id of [threadId, otherThread]) {
    yield* sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert({
      thread_id: id,
      project_id: "project",
      title: "Artifacts",
      default_provider: "codex",
      runtime_mode: "full-access",
      interaction_mode: "default",
      created_at: "2026-10-21",
      updated_at: "2026-10-21",
      payload_json: "{}",
    })}`;
  }
  const sourcePath = path.join(config.stateDir, "source.apk");
  yield* fs.writeFileString(sourcePath, "original apk bytes");
  const service = yield* Artifacts.ThreadArtifactService;
  const publish = {
    threadId,
    sourcePath,
    name: "app.apk",
    mimeType: "application/vnd.android.package-archive",
  };
  const token = (relativeUrl: string) => relativeUrl.split("/").at(-1)!;
  return { sql, fs, path, config, sourcePath, service, publish, token };
});

it.effect("runs artifact RPCs with authorization before reaching storage", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* setup;
      const client = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
        RpcTest.makeClient(ThreadArtifactRpcGroup).pipe(
          Effect.provide(
            Layer.mergeAll(
              ArtifactRpc.layer,
              RpcAuthorization.layer(scopes),
              rpcInstrumentationLayer,
            ),
          ),
        );
      const reader = yield* client([AuthOrchestrationReadScope]);
      expect(yield* reader[WS_METHODS.artifactsList]({ threadId })).toEqual({ artifacts: [] });
      expect((yield* reader[WS_METHODS.artifactsPublish](h.publish).pipe(Effect.flip))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
      expect((yield* h.service.list(threadId)).artifacts).toEqual([]);
      const writerWithoutFileAccess = yield* client([AuthOrchestrationOperateScope]);
      expect(
        yield* writerWithoutFileAccess[WS_METHODS.artifactsPublish](h.publish).pipe(Effect.flip),
      ).toMatchObject({ requiredPermission: AuthFilesystemReadScope });
      const fileReader = yield* client([AuthFilesystemReadScope]);
      expect(
        yield* fileReader[WS_METHODS.artifactsPublish](h.publish).pipe(Effect.flip),
      ).toMatchObject({ requiredPermission: AuthOrchestrationOperateScope });
      const writer = yield* client([AuthFilesystemReadScope, AuthOrchestrationOperateScope]);
      const { artifact } = yield* writer[WS_METHODS.artifactsPublish](h.publish);
      expect(
        (yield* reader[WS_METHODS.artifactsCreateDownloadUrl]({ threadId, id: artifact.id }).pipe(
          Effect.flip,
        ))._tag,
      ).toBe("EnvironmentAuthorizationError");
      const url = yield* fileReader[WS_METHODS.artifactsCreateDownloadUrl]({
        threadId,
        id: artifact.id,
      });
      expect(url.relativeUrl).toContain("/api/thread-artifacts/download/");
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("serves binary uploads and named downloads through the HTTP routes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* setup;
      yield* HttpRouter.serve(
        Layer.mergeAll(layerArtifactUploadRoute, layerArtifactDownloadRoute),
        {
          disableListenLog: true,
          disableLogger: true,
        },
      ).pipe(Layer.build);
      const client = yield* HttpClient.HttpClient;
      const bytes = new Uint8Array([0, 255, 128, 64, 1, 2]);
      const upload = yield* h.service.createUploadUrl({
        threadId,
        name: "build.apk",
        mimeType: "application/vnd.android.package-archive",
        sizeBytes: bytes.length,
      });
      const sent = yield* client.post(upload.relativeUrl, { body: HttpBody.uint8Array(bytes) });
      expect(sent.status).toBe(204);
      const artifact = (yield* h.service.list(threadId)).artifacts[0]!;
      const download = yield* h.service.createDownloadUrl({ threadId, id: artifact.id });
      const response = yield* client.get(download.relativeUrl);
      expect(response.status).toBe(200);
      expect(response.headers["content-disposition"]).toContain('filename="build.apk"');
      expect(response.headers["content-type"]).toBe("application/vnd.android.package-archive");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(new Uint8Array(yield* response.arrayBuffer)).toEqual(bytes);
      yield* h.service.remove({ threadId, id: artifact.id, expectedRevision: artifact.revision });
      expect((yield* client.get(download.relativeUrl)).status).toBe(404);
    }),
  ).pipe(Effect.provide(Layer.mergeAll(layer, NodeHttpServer.layerTest))),
);

it.effect(
  "copies an artifact, persists it across service recreation, and retains it after settling",
  () =>
    Effect.gen(function* () {
      const h = yield* setup;
      const { artifact } = yield* h.service.publish(h.publish);
      yield* h.fs.remove(h.sourcePath);
      const recreated = yield* Artifacts.ThreadArtifactService.pipe(
        Effect.provide(Artifacts.layer),
      );
      expect((yield* recreated.list(threadId)).artifacts).toEqual([artifact]);
      // Settling archives a thread; only deletion ends artifact ownership.
      yield* h.sql`UPDATE orchestration_v2_projection_threads SET archived_at = '2026-10-21' WHERE thread_id = ${threadId}`;
      yield* recreated.cleanupDeletedThread(threadId);
      const url = yield* recreated.createDownloadUrl({ threadId, id: artifact.id });
      const download = yield* recreated.resolveDownload(h.token(url.relativeUrl));
      expect(download.fileName).toBe("app.apk");
      expect(download.download).toBe(true);
      expect(yield* h.fs.readFileString(download.path)).toBe("original apk bytes");
    }).pipe(Effect.provide(layer)),
);

it.effect("replaces bytes atomically and rejects stale edits and cross-thread access", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const { artifact } = yield* h.service.publish(h.publish);
    const oldUrl = yield* h.service.createDownloadUrl({ threadId, id: artifact.id });
    const oldFile = yield* h.service.resolveDownload(h.token(oldUrl.relativeUrl));
    yield* h.fs.writeFileString(h.sourcePath, "new apk bytes");
    const next = yield* h.service.publish({
      ...h.publish,
      replace: { id: artifact.id, expectedRevision: 0 },
    });
    expect(next.artifact.revision).toBe(1);
    expect(yield* h.fs.exists(oldFile.path)).toBe(false);
    expect(
      (yield* h.service.resolveDownload(h.token(oldUrl.relativeUrl)).pipe(Effect.flip)).reason,
    ).toBe("not_found");
    expect(
      (yield* h.service
        .rename({ threadId, id: artifact.id, expectedRevision: 0, name: "stale.apk" })
        .pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(
      (yield* h.service
        .remove({ threadId, id: artifact.id, expectedRevision: 0 })
        .pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(
      (yield* h.service
        .createDownloadUrl({ threadId: otherThread, id: artifact.id })
        .pipe(Effect.flip)).reason,
    ).toBe("not_found");
    const renamed = yield* h.service.rename({
      threadId,
      id: artifact.id,
      expectedRevision: 1,
      name: "latest.apk",
    });
    expect(renamed.artifact.revision).toBe(2);
    expect(renamed.artifact.name).toBe("latest.apk");
    const download = yield* h.service.createDownloadUrl({ threadId, id: artifact.id });
    const file = yield* h.service.resolveDownload(h.token(download.relativeUrl));
    expect(yield* h.fs.readFileString(file.path)).toBe("new apk bytes");
    yield* h.service.remove({ threadId, id: artifact.id, expectedRevision: 2 });
    expect(yield* h.fs.exists(file.path)).toBe(false);
    expect((yield* h.service.list(threadId)).artifacts).toEqual([]);
  }).pipe(Effect.provide(layer)),
);

it.effect("streams uploads, rejects incomplete/oversized bodies, and prevents token replay", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const url = yield* h.service.createUploadUrl({
      threadId,
      name: "uploaded.apk",
      mimeType: "application/octet-stream",
      sizeBytes: 6,
    });
    const bytes = (s: string) => new TextEncoder().encode(s);
    const token = h.token(url.relativeUrl);
    expect(
      (yield* h.service.upload(token, Stream.make(bytes("short"))).pipe(Effect.flip)).reason,
    ).toBe("invalid_upload");
    expect(
      (yield* h.service.upload(token, Stream.make(bytes("too long"))).pipe(Effect.flip)).reason,
    ).toBe("invalid_upload");
    expect((yield* h.service.list(threadId)).artifacts).toEqual([]);
    const root = h.path.join(h.config.stateDir, "thread-artifacts");
    expect(yield* h.fs.readDirectory(root)).toEqual([]);
    yield* h.service.upload(token, Stream.make(bytes("abc"), bytes("def")));
    expect(
      (yield* h.service.upload(token, Stream.make(bytes("abcdef"))).pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(yield* h.fs.readDirectory(root)).toHaveLength(1);
    expect((yield* h.service.list(threadId)).artifacts[0]?.sizeBytes).toBe(6);
  }).pipe(Effect.provide(layer)),
);

it.effect("rejects expired, tampered, and wrong-purpose URLs", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const url = yield* h.service.createUploadUrl({
      threadId,
      name: "empty.txt",
      mimeType: "text/plain",
      sizeBytes: 0,
    });
    const token = h.token(url.relativeUrl);
    expect((yield* h.service.upload(`x${token}`, Stream.empty).pipe(Effect.flip)).reason).toBe(
      "invalid_upload",
    );
    yield* h.service.upload(token, Stream.empty);
    const artifact = (yield* h.service.list(threadId)).artifacts[0]!;
    const download = yield* h.service.createDownloadUrl({ threadId, id: artifact.id });
    expect(
      (yield* h.service.upload(h.token(download.relativeUrl), Stream.empty).pipe(Effect.flip))
        .reason,
    ).toBe("invalid_upload");
    yield* TestClock.adjust("61 minutes");
    expect(
      (yield* h.service.resolveDownload(h.token(download.relativeUrl)).pipe(Effect.flip)).reason,
    ).toBe("invalid_upload");
    expect((yield* h.service.upload(token, Stream.empty).pipe(Effect.flip)).reason).toBe(
      "invalid_upload",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("notifies subscribed clients of agent mutations without polling", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const ready = yield* Deferred.make<void>();
    const fiber = yield* h.service.subscribe(threadId).pipe(
      Stream.tap(() => Deferred.succeed(ready, undefined)),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(ready);
    const { artifact } = yield* h.service.publish(h.publish);
    const results = yield* Fiber.join(fiber);
    expect(Array.from(results)).toEqual([{ artifacts: [] }, { artifacts: [artifact] }]);
  }).pipe(Effect.provide(layer)),
);

it.effect("cleans a cancelled streaming upload without publishing a partial artifact", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const ready = yield* Deferred.make<void>();
    const url = yield* h.service.createUploadUrl({
      threadId,
      name: "partial.apk",
      mimeType: "application/octet-stream",
      sizeBytes: 100,
    });
    const body = Stream.concat(
      Stream.make(new Uint8Array([1, 2, 3])),
      Stream.fromEffect(Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never))),
    );
    const fiber = yield* h.service.upload(h.token(url.relativeUrl), body).pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    yield* Fiber.interrupt(fiber);
    expect((yield* h.service.list(threadId)).artifacts).toEqual([]);
    expect(yield* h.fs.readDirectory(h.path.join(h.config.stateDir, "thread-artifacts"))).toEqual(
      [],
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("allows only one concurrent edit at a given artifact revision", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const { artifact } = yield* h.service.publish(h.publish);
    // @effect-diagnostics-next-line allOfMapToForEach:off
    const results = yield* Effect.all(
      ["first.apk", "second.apk"].map((name) =>
        h.service
          .rename({ threadId, id: artifact.id, expectedRevision: 0, name })
          .pipe(Effect.result),
      ),
      { concurrency: "unbounded" },
    );
    expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
    const failure = results.find((r) => r._tag === "Failure");
    expect(failure?._tag === "Failure" ? failure.failure.reason : null).toBe("conflict");
    expect((yield* h.service.list(threadId)).artifacts[0]?.revision).toBe(1);
  }).pipe(Effect.provide(layer)),
);

it.effect("streams files larger than the chat attachment limit into durable storage", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const sizeBytes = 64 * 1024 * 1024;
    yield* h.fs.truncate(h.sourcePath, sizeBytes);
    const { artifact } = yield* h.service.publish(h.publish);
    const url = yield* h.service.createDownloadUrl({ threadId, id: artifact.id });
    const file = yield* h.service.resolveDownload(h.token(url.relativeUrl));
    expect(artifact.sizeBytes).toBe(sizeBytes);
    expect((yield* h.fs.stat(file.path)).size).toBe(BigInt(sizeBytes));
  }).pipe(Effect.provide(layer)),
);

it.effect("revokes downloads and cleans bytes when the owning thread is deleted", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    const { artifact } = yield* h.service.publish(h.publish);
    const url = yield* h.service.createDownloadUrl({ threadId, id: artifact.id });
    const file = yield* h.service.resolveDownload(h.token(url.relativeUrl));
    const upload = yield* h.service.createUploadUrl({
      threadId,
      name: "late.txt",
      mimeType: "text/plain",
      sizeBytes: 0,
    });
    yield* h.sql`UPDATE orchestration_v2_projection_threads SET deleted_at = '2026-10-21' WHERE thread_id = ${threadId}`;
    expect(
      (yield* h.service.upload(h.token(upload.relativeUrl), Stream.empty).pipe(Effect.flip)).reason,
    ).toBe("thread_unavailable");
    expect(
      (yield* h.service.resolveDownload(h.token(url.relativeUrl)).pipe(Effect.flip)).reason,
    ).toBe("thread_unavailable");
    yield* h.service.cleanupDeletedThread(threadId);
    expect(yield* h.fs.exists(file.path)).toBe(false);
    expect(yield* h.sql`SELECT * FROM thread_artifacts`).toEqual([]);
  }).pipe(Effect.provide(layer)),
);

it.effect("rejects directories, relative paths, and files above the artifact size limit", () =>
  Effect.gen(function* () {
    const h = yield* setup;
    expect(
      (yield* h.service.publish({ ...h.publish, sourcePath: "relative.apk" }).pipe(Effect.flip))
        .reason,
    ).toBe("invalid_file");
    expect(
      (yield* h.service.publish({ ...h.publish, sourcePath: h.config.stateDir }).pipe(Effect.flip))
        .reason,
    ).toBe("invalid_file");
    yield* h.fs.truncate(h.sourcePath, THREAD_ARTIFACT_MAX_BYTES + 1);
    expect((yield* h.service.publish(h.publish).pipe(Effect.flip)).reason).toBe("too_large");
  }).pipe(Effect.provide(layer)),
);
