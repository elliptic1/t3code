import { ThreadArtifactRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import * as Artifacts from "./ThreadArtifactService.ts";

// Keep domain handlers separate so the main WS handler's inferred type stays bounded.
const group = ThreadArtifactRpcGroup.middleware(RpcInstrumentation);
export const layer = group.toLayer(
  Effect.map(Artifacts.ThreadArtifactService, (artifacts) =>
    group.of({
      [WS_METHODS.artifactsList]: (input) => artifacts.list(input.threadId),
      [WS_METHODS.artifactsSubscribe]: (input) => artifacts.subscribe(input.threadId),
      [WS_METHODS.artifactsPublish]: (input) => artifacts.publish(input),
      [WS_METHODS.artifactsRename]: (input) => artifacts.rename(input),
      [WS_METHODS.artifactsDelete]: (input) => artifacts.remove(input),
      [WS_METHODS.artifactsCreateUploadUrl]: (input) => artifacts.createUploadUrl(input),
      [WS_METHODS.artifactsCreateDownloadUrl]: (input) => artifacts.createDownloadUrl(input),
    }),
  ),
);
