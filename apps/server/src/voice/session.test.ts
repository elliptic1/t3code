import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { VOICE_CONNECTION_PRESETS } from "@t3tools/contracts";
import { createVoiceSession, validateVoiceConnection } from "./session.ts";

describe("voice session credentials", () => {
  it.effect("uses the configured endpoint and returns only an ephemeral key", () =>
    Effect.gen(function* () {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ value: "ephemeral" }));
      const settings = {
        ...VOICE_CONNECTION_PRESETS.openai,
        enabled: true,
        apiKey: "permanent-secret",
        model: "custom-voice-model",
      };
      const result = yield* createVoiceSession(settings, fetcher);
      expect(result.clientSecret).toBe("ephemeral");
      expect(result).not.toHaveProperty("apiKey");
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(settings.tokenEndpoint);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer permanent-secret" });
      expect(String(init?.body)).toContain('"model":"custom-voice-model"');
      expect(init?.redirect).toBe("error");
    }),
  );
  it.effect("uses the xAI token request shape", () =>
    Effect.gen(function* () {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ value: "xai-ephemeral" }));
      const result = yield* createVoiceSession(
        { ...VOICE_CONNECTION_PRESETS.xai, enabled: true },
        fetcher,
      );
      expect(result.protocol).toBe("xai");
      expect(fetcher.mock.calls[0]![1]?.body).toBe('{"expires_after":{"seconds":60}}');
    }),
  );
  it.effect("supports local endpoints without contacting a token service", () =>
    Effect.gen(function* () {
      const fetcher = vi.fn<typeof fetch>();
      const result = yield* createVoiceSession(
        { ...VOICE_CONNECTION_PRESETS.local, enabled: true },
        fetcher,
      );
      expect(result.clientSecret).toBe("");
      expect(fetcher).not.toHaveBeenCalled();
    }),
  );
  it.effect("rejects disabled voice before making a network request", () =>
    Effect.gen(function* () {
      const fetcher = vi.fn<typeof fetch>();
      const failure = yield* createVoiceSession(VOICE_CONNECTION_PRESETS.openai, fetcher).pipe(
        Effect.flip,
      );
      expect(failure.message).toContain("Enable voice");
      expect(fetcher).not.toHaveBeenCalled();
    }),
  );
  it("rejects mismatched transports and permanent browser credentials", () => {
    expect(() =>
      validateVoiceConnection({
        ...VOICE_CONNECTION_PRESETS.local,
        endpoint: "https://localhost:8000",
      }),
    ).toThrow("transport");
    expect(() =>
      validateVoiceConnection({ ...VOICE_CONNECTION_PRESETS.local, apiKey: "secret" }),
    ).toThrow("client-secret");
  });
  it.effect("does not expose provider error bodies or credentials", () =>
    Effect.gen(function* () {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("secret-provider-body", { status: 401 }));
      const failure = yield* createVoiceSession(
        { ...VOICE_CONNECTION_PRESETS.openai, enabled: true },
        fetcher,
      ).pipe(Effect.flip);
      expect(failure.message).not.toContain("secret-provider-body");
      expect(failure.message).toContain("HTTP 401");
    }),
  );
  it.effect("rejects malformed ephemeral responses", () =>
    Effect.gen(function* () {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: "" }));
      const failure = yield* createVoiceSession(
        { ...VOICE_CONNECTION_PRESETS.openai, enabled: true },
        fetcher,
      ).pipe(Effect.flip);
      expect(failure.message).toContain("invalid client secret");
    }),
  );
});
