import * as Schema from "effect/Schema";
import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const THREAD_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const ThreadArtifactId = Schema.String.check(Schema.isUUID());
const FileName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(255),
  Schema.isPattern(/^[^/\\\p{Cc}]+$/u),
);
const MimeType = TrimmedNonEmptyString.check(
  Schema.isMaxLength(100),
  Schema.isPattern(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/),
);
export const ThreadArtifact = Schema.Struct({
  id: ThreadArtifactId,
  threadId: ThreadId,
  name: FileName,
  mimeType: MimeType,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(THREAD_ARTIFACT_MAX_BYTES)),
  revision: NonNegativeInt,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ThreadArtifact = typeof ThreadArtifact.Type;
export const ThreadArtifactListInput = Schema.Struct({ threadId: ThreadId });
export const ThreadArtifactListResult = Schema.Struct({ artifacts: Schema.Array(ThreadArtifact) });
export type ThreadArtifactListResult = typeof ThreadArtifactListResult.Type;
export const ThreadArtifactTarget = Schema.Struct({ threadId: ThreadId, id: ThreadArtifactId });
export const ThreadArtifactChangeInput = Schema.Struct({
  ...ThreadArtifactTarget.fields,
  expectedRevision: NonNegativeInt,
});
export type ThreadArtifactChangeInput = typeof ThreadArtifactChangeInput.Type;
export const ThreadArtifactRenameInput = Schema.Struct({
  ...ThreadArtifactChangeInput.fields,
  name: FileName,
});
export type ThreadArtifactRenameInput = typeof ThreadArtifactRenameInput.Type;
const Replacement = Schema.optionalKey(
  Schema.Struct({
    id: ThreadArtifactId,
    expectedRevision: NonNegativeInt,
  }),
);
export const ThreadArtifactPublishInput = Schema.Struct({
  threadId: ThreadId,
  sourcePath: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  name: FileName,
  mimeType: MimeType,
  replace: Replacement,
});
export type ThreadArtifactPublishInput = typeof ThreadArtifactPublishInput.Type;
export const ThreadArtifactUploadInput = Schema.Struct({
  threadId: ThreadId,
  name: FileName,
  mimeType: MimeType,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(THREAD_ARTIFACT_MAX_BYTES)),
  replace: Replacement,
});
export type ThreadArtifactUploadInput = typeof ThreadArtifactUploadInput.Type;
export const ThreadArtifactUrlResult = Schema.Struct({
  relativeUrl: Schema.String,
  expiresAt: Schema.Number,
});
export const ThreadArtifactResult = Schema.Struct({ artifact: ThreadArtifact });
export class ThreadArtifactError extends Schema.TaggedError<ThreadArtifactError>()(
  "ThreadArtifactError",
  {
    reason: Schema.Literals([
      "not_found",
      "thread_unavailable",
      "conflict",
      "too_large",
      "invalid_file",
      "invalid_upload",
      "storage",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not_found":
        return "The artifact was not found.";
      case "thread_unavailable":
        return "The thread is unavailable.";
      case "conflict":
        return "The artifact changed. Refresh it before trying again.";
      case "too_large":
        return "Artifacts can be up to 2 GB.";
      case "invalid_file":
        return "Choose a regular file on the server using its absolute path.";
      case "invalid_upload":
        return "The artifact upload is invalid or expired.";
      case "storage":
        return "Could not save or load the artifact.";
    }
  }
}
