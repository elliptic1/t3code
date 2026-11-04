import * as Effect from "effect/Effect";
import * as Artifacts from "../../../artifacts/ThreadArtifactService.ts";
import { readThread } from "../../threadAccess.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ArtifactToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(ArtifactToolkit, {
  artifact_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId, []);
      const service = yield* Artifacts.ThreadArtifactService;
      return yield* service.list(projection.thread.id);
    }),
  ),
  artifact_publish: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId, []);
        const service = yield* Artifacts.ThreadArtifactService;
        return yield* service.publish({ ...input, threadId: projection.thread.id });
      }),
  ),
  artifact_rename: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId, []);
        const service = yield* Artifacts.ThreadArtifactService;
        return yield* service.rename({ ...input, threadId: projection.thread.id });
      }),
  ),
  artifact_delete: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId, []);
        const service = yield* Artifacts.ThreadArtifactService;
        yield* service.remove({ ...input, threadId: projection.thread.id });
      }),
  ),
});
