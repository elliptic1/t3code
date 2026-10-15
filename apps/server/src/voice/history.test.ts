import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { makeVoiceHistory } from "./history.ts";

const scenario = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  return { fs, dir, file: path.join(dir, "voice-history.json") };
});

describe("shared voice history", () => {
  it.effect("Start fresh clears shared history across a restart", () =>
    Effect.gen(function* () {
      const { file } = yield* scenario;
      const server = yield* makeVoiceHistory(file);
      yield* server.sync([{ id: "mac:1", speaker: "You", text: "Forget this" }]);
      yield* server.sync([], true);
      const phone = yield* makeVoiceHistory(file);
      expect(yield* phone.sync([])).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "continues Mac to phone and back after a server restart without overwriting other clients",
    () =>
      Effect.gen(function* () {
        const { file } = yield* scenario;
        const server = yield* makeVoiceHistory(file);
        expect(yield* server.sync([])).toEqual([]);
        const mac = {
          id: "mac:1",
          speaker: "You",
          text: "The release is called Bluebird.",
        } as const;
        yield* server.sync([mac]);
        const phone = yield* makeVoiceHistory(file);
        expect(yield* phone.sync([])).toEqual([mac]);
        const reply = { id: "phone:1", speaker: "T3", text: "Let's continue Bluebird." } as const;
        yield* phone.sync([reply]);
        yield* server.sync([{ ...mac, text: "The release is called Bluebird!" }]);
        expect(yield* phone.sync([])).toEqual([
          { ...mac, text: "The release is called Bluebird!" },
          reply,
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "serializes concurrent clients, deduplicates revisions, and bounds stored history",
    () =>
      Effect.gen(function* () {
        const { file } = yield* scenario;
        const server = yield* makeVoiceHistory(file);
        yield* Effect.all(
          Array.from({ length: 50 }, (_, index) =>
            server.sync([{ id: String(index), speaker: "You", text: `line ${index}` }]),
          ),
          { concurrency: "unbounded" },
        );
        const history = yield* server.sync([]);
        expect(history).toHaveLength(40);
        expect(new Set(history.map((line) => line.id)).size).toBe(40);
        yield* server.sync(history);
        expect(yield* server.sync([])).toEqual(history);
        const restarted = yield* makeVoiceHistory(file);
        expect(yield* restarted.sync([])).toEqual(history);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("does not replace unreadable history with an empty conversation", () =>
    Effect.gen(function* () {
      const { file, fs } = yield* scenario;
      yield* fs.writeFileString(file, "broken");
      const server = yield* makeVoiceHistory(file);
      const result = yield* server
        .sync([{ id: "new", speaker: "You", text: "Hi" }])
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      expect(yield* fs.readFileString(file)).toBe("broken");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
