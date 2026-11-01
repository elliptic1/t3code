import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";
import {
  THREAD_ARTIFACT_MAX_BYTES,
  ThreadArtifactUploadInput,
  ThreadArtifactRenameInput,
} from "./threadArtifact.ts";

const upload = Schema.decodeUnknownSync(ThreadArtifactUploadInput);
const rename = Schema.decodeUnknownSync(ThreadArtifactRenameInput);
const base = {
  threadId: ThreadId.make("thread"),
  name: "app.apk",
  mimeType: "application/vnd.android.package-archive",
  sizeBytes: 150 * 1024 * 1024,
};

it("accepts APKs larger than composer attachments and caps artifact uploads at 2 GB", () => {
  expect(upload(base).sizeBytes).toBe(base.sizeBytes);
  expect(upload({ ...base, sizeBytes: THREAD_ARTIFACT_MAX_BYTES }).sizeBytes).toBe(
    THREAD_ARTIFACT_MAX_BYTES,
  );
  expect(() => upload({ ...base, sizeBytes: THREAD_ARTIFACT_MAX_BYTES + 1 })).toThrow();
});

it("rejects path separators, control characters and invalid MIME headers in file metadata", () => {
  for (const name of ["../app.apk", "folder/app.apk", "folder\\app.apk", "bad\r\nname.apk", ""]) {
    expect(() => upload({ ...base, name })).toThrow();
  }
  expect(() => upload({ ...base, mimeType: "text/plain\r\nX-Test: injected" })).toThrow();
});

it("requires a revision when replacing or renaming a published artifact", () => {
  const id = "28b7e80d-b79d-4c89-8d1f-9a22cb34e0d6";
  expect(() => upload({ ...base, replace: { id } })).toThrow();
  expect(() =>
    rename({
      threadId: base.threadId,
      id,
      name: "latest.apk",
    }),
  ).toThrow();
  expect(upload({ ...base, replace: { id, expectedRevision: 3 } }).replace?.expectedRevision).toBe(
    3,
  );
});
