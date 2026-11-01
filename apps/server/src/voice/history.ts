import {
  VoiceConversationHistory,
  VoiceSessionError,
  VOICE_HISTORY_LINES,
  type VoiceTranscriptLine,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";

const codec = Schema.fromJsonString(VoiceConversationHistory);
const decode = Schema.decodeUnknownEffect(codec);
const encode = Schema.encodeEffect(codec);

/** One bounded transcript per environment, shared by all of its clients. */
export const makeVoiceHistory = Effect.fn("voice.makeHistory")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const sync = (incoming: readonly VoiceTranscriptLine[], reset = false) =>
    Effect.gen(function* () {
      const raw = yield* fs.readFileString(filePath).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed("[]"),
        ),
      );
      const previous = yield* decode(raw);
      let lines = reset ? [] : [...previous];
      // Upsert only this session's changes: a stale device must never replace another's history.
      for (const line of incoming) {
        const index = lines.findIndex((old) => old.id === line.id);
        if (index < 0) lines.push(line);
        else lines[index] = line;
      }
      lines = lines.slice(-VOICE_HISTORY_LINES);
      const contents = yield* encode(lines);
      if (contents !== (yield* encode(previous))) {
        yield* writeFileStringAtomically({ filePath, contents }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
      }
      return lines;
    }).pipe(
      lock.withPermits(1),
      Effect.mapError(
        () =>
          new VoiceSessionError({
            message:
              "Could not sync voice conversation history. Try again before switching devices.",
          }),
      ),
    );
  return { sync };
});

export class VoiceHistory extends Context.Service<
  VoiceHistory,
  Effect.Success<ReturnType<typeof makeVoiceHistory>>
>()("t3/voice/history/VoiceHistory") {}

export const layer = Layer.effect(
  VoiceHistory,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return yield* makeVoiceHistory(path.join(config.stateDir, "voice-history.json"));
  }),
);
