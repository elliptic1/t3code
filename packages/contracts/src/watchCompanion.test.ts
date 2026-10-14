import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { WatchCompanionRequest } from "./watchCompanion.ts";

const decode = Schema.decodeUnknownSync(WatchCompanionRequest);

describe("watch companion protocol", () => {
  it("rejects arbitrary RPC requests from the watch", () => {
    expect(() =>
      decode({ requestId: "1", operation: "rpc", method: "server.updateSettings" }),
    ).toThrow();
  });

  it("requires an environment for thread access and sending", () => {
    expect(() => decode({ requestId: "1", operation: "thread", threadId: "thread" })).toThrow();
    expect(() =>
      decode({ requestId: "1", operation: "send", threadId: "thread", text: "hello", busy: false }),
    ).toThrow();
  });

  it("bounds message size before accepting a send", () => {
    expect(() =>
      decode({
        requestId: "1",
        operation: "send",
        environmentId: "environment",
        threadId: "thread",
        text: "x".repeat(32001),
        busy: false,
      }),
    ).toThrow();
  });
});
