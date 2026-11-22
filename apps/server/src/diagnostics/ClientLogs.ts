import {
  CLIENT_LOG_DEFAULT_LINES,
  type ClientLogReadResult,
  type ClientLogRequest,
  ClientLogUploadError,
  type ClientLogUploadInput,
  type ClientLogUploadResult,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";

const CLIENT_LOG_FILES_KEPT = 10;
const LATEST_LOG_NAME = "latest.log";
const TIMESTAMPED_LOG_NAME = /^\d{4}-\d{2}-\d{2}T[\d-]+(?:\.\d+)?Z\.log$/;
export const CLIENT_LOG_REQUEST_TIMEOUT = "15 seconds";
// A tool result carries the tail; the whole capture stays in the file at `path`.
const READ_RESULT_MAX_CHARACTERS = 48_000;

/** Maps a client id to one directory name that cannot leave `clients/`. */
const sanitizeClientLogDirectoryName = (clientId: string) =>
  clientId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, (dots) => "_".repeat(dots.length));

const headerValue = (value: string) => value.replace(/[\r\n]+/g, " ");

export class ClientLogReadError extends Schema.TaggedError<ClientLogReadError>()(
  "ClientLogReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the saved client logs.";
  }
}

interface SavedClientLog {
  readonly path: string;
  readonly clientId: string;
  readonly clientLabel?: string;
  readonly platform?: "android" | "ios";
  readonly capturedAt: string;
  readonly log: string;
}

interface PublishedRequest {
  readonly clientId: string | undefined;
  readonly request: ClientLogRequest;
}

const formatLog = (saved: SavedClientLog, appVersion: string) =>
  [
    `# client: ${headerValue(saved.clientLabel ?? saved.clientId)}`,
    `# clientId: ${headerValue(saved.clientId)}`,
    `# platform: ${saved.platform}`,
    `# appVersion: ${headerValue(appVersion)}`,
    `# receivedAt: ${saved.capturedAt}`,
    "",
    saved.log,
  ].join("\n");

const parseLog = (path: string, contents: string): SavedClientLog => {
  const end = contents.indexOf("\n\n");
  const header = new Map(
    (end < 0 ? "" : contents.slice(0, end))
      .split("\n")
      .map((line) => /^# ([A-Za-z]+): (.*)$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]] as const),
  );
  const platform = header.get("platform");
  const clientLabel = header.get("client");
  return {
    path,
    clientId: header.get("clientId") ?? "",
    ...(clientLabel ? { clientLabel } : {}),
    ...(platform === "android" || platform === "ios" ? { platform } : {}),
    capturedAt: header.get("receivedAt") ?? "",
    log: end < 0 ? contents : contents.slice(end + 2),
  };
};

const present = (
  status: "fresh" | "saved",
  message: string,
  saved: SavedClientLog,
): ClientLogReadResult => {
  const truncated = saved.log.length > READ_RESULT_MAX_CHARACTERS;
  const tail = saved.log.slice(-READ_RESULT_MAX_CHARACTERS);
  return {
    status,
    message,
    path: saved.path,
    clientId: saved.clientId,
    ...(saved.clientLabel === undefined ? {} : { clientLabel: saved.clientLabel }),
    ...(saved.platform === undefined ? {} : { platform: saved.platform }),
    capturedAt: saved.capturedAt,
    log: truncated ? tail.slice(tail.indexOf("\n") + 1) : tail,
    truncated,
  };
};

/** Logs that clients send, saved where an agent on this machine can read them. */
export class ClientLogs extends Context.Service<
  ClientLogs,
  {
    readonly upload: (
      input: ClientLogUploadInput,
    ) => Effect.Effect<ClientLogUploadResult, ClientLogUploadError>;
    /** Requests for one client's logs, while it listens. */
    readonly requests: (clientId: string) => Stream.Stream<ClientLogRequest>;
    /** Asks listening clients for fresh logs, falling back to the newest saved ones. */
    readonly read: (input: {
      readonly clientId?: string | undefined;
      readonly maxLines?: number | undefined;
    }) => Effect.Effect<ClientLogReadResult, ClientLogReadError>;
  }
>()("t3/diagnostics/ClientLogs") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const published = yield* PubSub.unbounded<PublishedRequest>();
  const listeners = new Map<string, number>();
  const pending = new Map<
    string,
    { readonly clientId: string | undefined; readonly answer: Deferred.Deferred<SavedClientLog> }
  >();
  const clientsDir = path.resolve(config.logsDir, "clients");
  let requestCount = 0;

  const write = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const save = Effect.fn("ClientLogs.save")(
    function* (input: ClientLogUploadInput) {
      const directory = path.join(clientsDir, sanitizeClientLogDirectoryName(input.clientId));
      const capturedAt = DateTime.formatIso(yield* DateTime.now);
      const saved: SavedClientLog = {
        path: path.join(directory, `${capturedAt.replaceAll(":", "-")}.log`),
        clientId: input.clientId,
        ...(input.clientLabel === undefined ? {} : { clientLabel: input.clientLabel }),
        platform: input.platform,
        capturedAt,
        log: input.log,
      };
      const contents = formatLog(saved, input.appVersion);

      yield* fs.makeDirectory(directory, { recursive: true });
      yield* write(saved.path, contents);
      yield* write(path.join(directory, LATEST_LOG_NAME), contents);

      const stale = (yield* fs.readDirectory(directory))
        .filter((name) => TIMESTAMPED_LOG_NAME.test(name))
        .toSorted()
        .slice(0, -CLIENT_LOG_FILES_KEPT);
      yield* Effect.forEach(stale, (name) => fs.remove(path.join(directory, name)), {
        discard: true,
      });
      return saved;
    },
    lock.withPermits(1),
    Effect.mapError((cause) => new ClientLogUploadError({ cause })),
  );

  const upload = Effect.fn("ClientLogs.upload")(function* (input: ClientLogUploadInput) {
    const saved = yield* save(input);
    const waiting = input.requestId === undefined ? undefined : pending.get(input.requestId);
    if (waiting && (waiting.clientId === undefined || waiting.clientId === input.clientId)) {
      yield* Deferred.succeed(waiting.answer, saved);
    }
    return { path: saved.path };
  });

  const requests = (clientId: string) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before counting the listener, so a request it sees counted reaches it.
        const subscription = yield* PubSub.subscribe(published);
        yield* Effect.acquireRelease(
          Effect.sync(() => listeners.set(clientId, (listeners.get(clientId) ?? 0) + 1)),
          () =>
            Effect.sync(() => {
              const count = (listeners.get(clientId) ?? 1) - 1;
              if (count > 0) listeners.set(clientId, count);
              else listeners.delete(clientId);
            }),
        );
        return Stream.fromSubscription(subscription);
      }),
    ).pipe(
      Stream.filter((entry) => entry.clientId === undefined || entry.clientId === clientId),
      Stream.map((entry) => entry.request),
    );

  const newestSaved = Effect.fn("ClientLogs.newestSaved")(function* (clientId: string | undefined) {
    const directories =
      clientId === undefined
        ? yield* fs.readDirectory(clientsDir).pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "NotFound",
              () => Effect.succeed([]),
            ),
          )
        : [sanitizeClientLogDirectoryName(clientId)];
    const candidates = yield* Effect.forEach(directories, (directory) => {
      const latest = path.join(clientsDir, directory, LATEST_LOG_NAME);
      return fs.stat(latest).pipe(
        Effect.map((info) => Option.some({ latest, mtime: Option.getOrUndefined(info.mtime) })),
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeedNone,
        ),
      );
    });
    const newest = candidates
      .flatMap((candidate) => (Option.isSome(candidate) ? [candidate.value] : []))
      .toSorted((left, right) => (right.mtime?.getTime() ?? 0) - (left.mtime?.getTime() ?? 0))[0];
    if (newest === undefined) return undefined;
    const saved = parseLog(newest.latest, yield* fs.readFileString(newest.latest));
    // latest.log copies a timestamped file that pruning may remove; name a path that stays.
    const timestamped = path.join(
      path.dirname(newest.latest),
      `${saved.capturedAt.replaceAll(":", "-")}.log`,
    );
    const kept = yield* fs.exists(timestamped);
    return { ...saved, path: kept ? timestamped : newest.latest };
  });

  const read = Effect.fn("ClientLogs.read")(
    function* (input: {
      readonly clientId?: string | undefined;
      readonly maxLines?: number | undefined;
    }) {
      const listening =
        input.clientId === undefined ? listeners.size > 0 : listeners.has(input.clientId);
      if (listening) {
        const requestId = `${++requestCount}-${(yield* Random.nextIntBetween(0, 0xffffff)).toString(16)}`;
        const answer = yield* Deferred.make<SavedClientLog>();
        pending.set(requestId, { clientId: input.clientId, answer });
        const fresh = yield* PubSub.publish(published, {
          clientId: input.clientId,
          request: { requestId, maxLines: input.maxLines ?? CLIENT_LOG_DEFAULT_LINES },
        }).pipe(
          Effect.andThen(Deferred.await(answer)),
          Effect.timeoutOption(CLIENT_LOG_REQUEST_TIMEOUT),
          Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
        );
        if (Option.isSome(fresh)) {
          return present("fresh", "Captured from the app just now.", fresh.value);
        }
      }
      const saved = yield* newestSaved(input.clientId);
      const why = listening
        ? `No app answered within ${CLIENT_LOG_REQUEST_TIMEOUT}.`
        : "No app is connected and listening for log requests.";
      if (saved === undefined) {
        return { status: "none", message: `${why} No saved app logs exist yet.` } as const;
      }
      return present(
        "saved",
        `${why} These are the newest saved logs, captured at ${saved.capturedAt}; they may not show recent events.`,
        saved,
      );
    },
    Effect.mapError((cause) => new ClientLogReadError({ cause })),
  );

  return ClientLogs.of({ upload, requests, read });
});

export const layer = Layer.effect(ClientLogs, make);
