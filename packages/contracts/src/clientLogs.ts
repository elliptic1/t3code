import * as Schema from "effect/Schema";

import { ClientActivityClientId } from "./background.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CLIENT_LOG_MAX_LENGTH = 4 * 1024 * 1024;
export const CLIENT_LOG_DEFAULT_LINES = 5000;
export const CLIENT_LOG_MAX_LINES = 20_000;

export const ClientLogRequestId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type ClientLogRequestId = typeof ClientLogRequestId.Type;

export const ClientLogPlatform = Schema.Literals(["android", "ios"]);

export const ClientLogUploadInput = Schema.Struct({
  requestId: Schema.optionalKey(ClientLogRequestId),
  clientId: ClientActivityClientId,
  clientLabel: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
  platform: ClientLogPlatform,
  appVersion: Schema.String.check(Schema.isMaxLength(64)),
  log: Schema.String.check(Schema.isMaxLength(CLIENT_LOG_MAX_LENGTH)),
});
export type ClientLogUploadInput = typeof ClientLogUploadInput.Type;

export const ClientLogUploadResult = Schema.Struct({
  path: Schema.String,
});
export type ClientLogUploadResult = typeof ClientLogUploadResult.Type;

export class ClientLogUploadError extends Schema.TaggedError<ClientLogUploadError>()(
  "ClientLogUploadError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "Could not save the client logs.";
  }
}

export const ClientLogRequestsInput = Schema.Struct({
  clientId: ClientActivityClientId,
});
export type ClientLogRequestsInput = typeof ClientLogRequestsInput.Type;

/** The server asks a client for its logs; the client answers with an upload carrying `requestId`. */
export const ClientLogRequest = Schema.Struct({
  requestId: ClientLogRequestId,
  maxLines: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: CLIENT_LOG_MAX_LINES })),
});
export type ClientLogRequest = typeof ClientLogRequest.Type;

export const ClientLogReadResult = Schema.Struct({
  status: Schema.Literals(["fresh", "saved", "none"]).annotate({
    description:
      "`fresh`: just captured from the app. `saved`: no app answered, so this is the newest log on disk; check `capturedAt`. `none`: no app answered and none is saved.",
  }),
  message: Schema.String,
  path: Schema.optionalKey(Schema.String),
  clientId: Schema.optionalKey(Schema.String),
  clientLabel: Schema.optionalKey(Schema.String),
  platform: Schema.optionalKey(ClientLogPlatform),
  capturedAt: Schema.optionalKey(Schema.String),
  log: Schema.optionalKey(Schema.String),
  truncated: Schema.optionalKey(Schema.Boolean),
});
export type ClientLogReadResult = typeof ClientLogReadResult.Type;
