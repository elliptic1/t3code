import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId } from "./baseSchemas.ts";

const requestId = { requestId: Schema.String };
export const WatchCompanionRequest = Schema.Union([
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
