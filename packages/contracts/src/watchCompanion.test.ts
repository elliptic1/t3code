import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { WatchCompanionRequest } from "./watchCompanion.ts";

const decode = Schema.decodeUnknownSync(WatchCompanionRequest);

describe("watch companion protocol", () => {
  it("routes watch voice through the phone with bounded server history", () => {
    expect(
      decode({ requestId: "start", operation: "voiceStart", sessionId: "session" }).operation,
    ).toBe("voiceStart");
    expect(
      decode({
        requestId: "save",
        operation: "voiceHistory",
        environmentId: "env",
        lines: [{ id: "watch:1", speaker: "You", text: "Remember Bluebird" }],
      }).operation,
    ).toBe("voiceHistory");
    expect(() => decode({ requestId: "save", operation: "voiceHistory", lines: [] })).toThrow();
    expect(() =>
      decode({
        requestId: "save",
        operation: "voiceHistory",
        environmentId: "env",
        lines: Array.from({ length: 41 }, (_, i) => ({
          id: String(i),
          speaker: "You",
          text: "hello",
        })),
      }),
    ).toThrow();
  });
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
