import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { BearerConnectionProfile } from "./catalog.ts";
import { connectionDiagnostics } from "./diagnostics.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  BearerConnectionTarget,
  ConnectionBlockedError,
  RelayConnectionTarget,
} from "./model.ts";

describe("connection diagnostics", () => {
  it("copies a disconnected identity mismatch and every saved route without URL credentials", () => {
    const environmentId = EnvironmentId.make("expected-environment");
    const target = new BearerConnectionTarget({
      environmentId,
      label: "Mac mini",
      connectionId: "saved-connection",
    });
    const error = "Connected environment actual-environment does not match expected-environment.";
    const report = connectionDiagnostics({
      environment: {
        entry: {
          target,
          enabled: true,
          profile: Option.some(
            new BearerConnectionProfile({
              connectionId: target.connectionId,
              environmentId,
              label: target.label,
              httpBaseUrl: "http://user:secret@192.168.0.102:3773/?token=private#credential",
              wsBaseUrl: "ws://user:secret@192.168.0.102:3773/?token=private",
            }),
          ),
          alternateRoutes: [
            {
              target: new RelayConnectionTarget({ environmentId, label: target.label }),
              profile: Option.none(),
            },
          ],
        },
        connection: { phase: "error", error, traceId: "trace-1" },
        serverConfig: null,
      },
      state: {
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        phase: "blocked",
        network: "online",
        attempt: 3,
        lastFailure: new ConnectionBlockedError({
          reason: "configuration",
          detail: error,
          traceId: "trace-1",
        }),
      },
      client: { surface: "mobile", version: "0.0.45", platform: "android 36" },
      capturedAt: "2026-10-13T20:00:00.000Z",
    });
    expect(report).toContain(error);
    expect(report).toContain("trace-1");
    expect(report).toContain('"reason": "configuration"');
    expect(report).toContain('"attempt": 3');
    expect(report).toContain('"cachedServer": null');
    expect(report).toContain("http://192.168.0.102:3773/");
    expect(report).toContain("ws://192.168.0.102:3773/");
    expect(report).toContain('"kind": "relay"');
    expect(report).not.toContain("secret");
    expect(report).not.toContain("private");
    expect(report).not.toContain("credential");
  });
});
