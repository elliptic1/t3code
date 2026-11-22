import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as ServerConfig from "../config.ts";
import * as ClientLogs from "./ClientLogs.ts";

const TestLayer = ClientLogs.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-client-logs-" })),
  Layer.provideMerge(NodeServices.layer),
);

const input = {
  clientId: "mobile-abc",
  clientLabel: "Pixel 7 Pro",
  platform: "android",
  appVersion: "1.2.3",
  log: "11-22 10:00:00.000  1234  1234 I T3: hello",
} as const;

it.effect("keeps a client's uploads inside its own directory under the logs dir", () =>
  Effect.gen(function* () {
    const clientLogs = yield* ClientLogs.ClientLogs;
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const clientsDir = path.join(config.logsDir, "clients");

    for (const clientId of ["../../escape", "..", "a/b\\c", "mobile-ok_1.2"]) {
      const { path: saved } = yield* clientLogs.upload({ ...input, clientId });
      assert.strictEqual(path.dirname(path.dirname(saved)), clientsDir);
    }
    assert.deepEqual((yield* fs.readDirectory(clientsDir)).toSorted(), [
      "__",
      "___.._escape",
      "a_b_c",
      "mobile-ok_1.2",
    ]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("mirrors the newest upload to latest.log and keeps the newest ten", () =>
  Effect.gen(function* () {
    const clientLogs = yield* ClientLogs.ClientLogs;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const saved: string[] = [];
    for (let index = 0; index < 12; index++) {
      yield* TestClock.adjust("1 second");
      saved.push((yield* clientLogs.upload({ ...input, log: `line ${index}` })).path);
    }
    const directory = path.dirname(saved[0]!);

    const latest = yield* fs.readFileString(path.join(directory, "latest.log"));
    assert.strictEqual(latest, yield* fs.readFileString(saved[11]!));
    assert.include(latest, "# client: Pixel 7 Pro");
    assert.include(latest, "# platform: android");
    assert.include(latest, "# appVersion: 1.2.3");
    assert.isTrue(latest.endsWith("\n\nline 11"));

    assert.deepEqual(
      (yield* fs.readDirectory(directory)).toSorted(),
      [...saved.slice(2).map((file) => path.basename(file)), "latest.log"].toSorted(),
    );
  }).pipe(Effect.provide(TestLayer)),
);

/** A phone listening for requests. Started immediately, so it is listening once this returns. */
const listen = (clientId: string, log: string | null) =>
  Effect.gen(function* () {
    const clientLogs = yield* ClientLogs.ClientLogs;
    yield* clientLogs.requests(clientId).pipe(
      Stream.runForEach((request) =>
        log === null
          ? Effect.void
          : clientLogs.upload({ ...input, clientId, requestId: request.requestId, log }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
  });

it.effect("asks the listening phone and answers with the log it uploads", () =>
  Effect.gen(function* () {
    const clientLogs = yield* ClientLogs.ClientLogs;
    yield* listen("mobile-other", "other phone");
    yield* listen("mobile-abc", "line 1\nline 2");

    const result = yield* clientLogs.read({ clientId: "mobile-abc" });
    assert.strictEqual(result.status, "fresh");
    assert.strictEqual(result.clientId, "mobile-abc");
    assert.strictEqual(result.clientLabel, "Pixel 7 Pro");
    assert.strictEqual(result.log, "line 1\nline 2");
    assert.isFalse(result.truncated);
    const fs = yield* FileSystem.FileSystem;
    assert.isTrue((yield* fs.readFileString(result.path!)).endsWith("\n\nline 1\nline 2"));
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("falls back to the newest saved log when the listening phone does not answer", () =>
  Effect.gen(function* () {
    const clientLogs = yield* ClientLogs.ClientLogs;
    yield* TestClock.adjust("1 hour");
    const earlier = yield* clientLogs.upload({ ...input, log: "before the hang" });
    yield* listen("mobile-abc", null);

    const reading = yield* clientLogs.read({}).pipe(Effect.forkChild({ startImmediately: true }));
    yield* TestClock.adjust(ClientLogs.CLIENT_LOG_REQUEST_TIMEOUT);
    const result = yield* Fiber.join(reading);

    assert.strictEqual(result.status, "saved");
    assert.strictEqual(result.path, earlier.path);
    assert.strictEqual(result.capturedAt, "1970-01-01T01:00:00.000Z");
    assert.strictEqual(result.platform, "android");
    assert.strictEqual(result.log, "before the hang");
    assert.include(result.message, "No app answered");
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("answers at once from disk, or says nothing is saved, when no phone listens", () =>
  Effect.gen(function* () {
    const clientLogs = yield* ClientLogs.ClientLogs;
    const empty = yield* clientLogs.read({});
    assert.strictEqual(empty.status, "none");
    assert.isUndefined(empty.log);

    yield* clientLogs.upload({ ...input, log: "saved earlier" });
    const saved = yield* clientLogs.read({ clientId: "mobile-abc" });
    assert.strictEqual(saved.status, "saved");
    assert.strictEqual(saved.clientLabel, "Pixel 7 Pro");
    assert.strictEqual(saved.log, "saved earlier");
    assert.include(saved.message, "No app is connected");
    assert.strictEqual((yield* clientLogs.read({ clientId: "mobile-unknown" })).status, "none");
  }).pipe(Effect.provide(TestLayer)),
);
