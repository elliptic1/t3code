import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId } from "./baseSchemas.ts";

import { VoiceConversationHistory } from "./voice.ts";

const requestId = { requestId: Schema.String };
export const WatchCompanionRequest = Schema.Union([
  Schema.Struct({
    ...requestId,
    operation: Schema.Literal("voiceStart"),
    sessionId: Schema.String.check(Schema.isMaxLength(128)),
    environmentId: Schema.optionalKey(EnvironmentId),
  }),
  Schema.Struct({
    ...requestId,
    operation: Schema.Literal("voiceHistory"),
    environmentId: EnvironmentId,
    lines: VoiceConversationHistory,
  }),
  Schema.Struct({
    ...requestId,
    operation: Schema.Literal("voiceTool"),
    environmentId: EnvironmentId,
    callId: Schema.String,
    name: Schema.String,
    arguments: Schema.String.check(Schema.isMaxLength(32000)),
  }),
  Schema.Struct({ ...requestId, operation: Schema.Literal("shell") }),
  Schema.Struct({
    ...requestId,
    operation: Schema.Literal("thread"),
    cursor: Schema.optionalKey(Schema.String),
    environmentId: EnvironmentId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    ...requestId,
    operation: Schema.Literal("send"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
    text: Schema.String.check(Schema.isMaxLength(32000)),
    busy: Schema.Boolean,
  }),
]);
export type WatchCompanionRequest = typeof WatchCompanionRequest.Type;
