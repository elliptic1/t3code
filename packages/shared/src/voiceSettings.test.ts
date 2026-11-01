import { describe, expect, it } from "vite-plus/test";
import { VOICE_CONNECTION_PRESETS } from "@t3tools/contracts";
import {
  selectVoiceProvider,
  selectVoiceTransport,
  updateVoiceConnection,
  voiceProviderId,
  voiceTransportOptions,
} from "./voiceSettings";

describe("saved voice providers", () => {
  it("preserves each provider's credentials and edited connection across repeated switches", () => {
    const grok = {
      ...VOICE_CONNECTION_PRESETS.xai,
      enabled: true,
      model: "my-grok",
      voice: "ara",
      apiKey: "grok-test-key",
    };
    let settings = selectVoiceProvider(grok, "openai");
    expect(settings.apiKey).toBe("");
    expect(settings.endpoint).toBe(VOICE_CONNECTION_PRESETS.openai.endpoint);
    expect(settings.enabled).toBe(true);
    settings = updateVoiceConnection(settings, {
      model: "my-openai",
      voice: "cedar",
      apiKey: "openai-test-key",
    });
    settings = selectVoiceTransport(settings, "websocket");
    settings = selectVoiceProvider(settings, "xai");
    expect(settings.apiKey).toBe("grok-test-key");
    expect(settings.model).toBe("my-grok");
    expect(settings.voice).toBe("ara");
    settings = selectVoiceProvider(settings, "openai");
    expect(settings.apiKey).toBe("openai-test-key");
    expect(settings.model).toBe("my-openai");
    expect(settings.voice).toBe("cedar");
    expect(settings.endpoint).toBe("wss://api.openai.com/v1/realtime");
    expect(settings.transport).toBe("websocket");
  });

  it("changes OpenAI endpoints with transport and prevents direct Grok WebRTC", () => {
    const ws = selectVoiceTransport(VOICE_CONNECTION_PRESETS.openai, "websocket");
    expect(ws.endpoint).toBe("wss://api.openai.com/v1/realtime");
    expect(selectVoiceTransport(ws, "webrtc").endpoint).toBe(
      VOICE_CONNECTION_PRESETS.openai.endpoint,
    );
    expect(voiceTransportOptions("xai")).toEqual(["websocket"]);
    expect(selectVoiceTransport(VOICE_CONNECTION_PRESETS.xai, "webrtc")).toBe(
      VOICE_CONNECTION_PRESETS.xai,
    );
  });

  it("recognizes existing settings by endpoint and preserves a custom setup separately", () => {
    expect(voiceProviderId(VOICE_CONNECTION_PRESETS.xai)).toBe("xai");
    const custom = {
      ...VOICE_CONNECTION_PRESETS.local,
      endpoint: "ws://my-server:8000/realtime",
      apiKey: "custom-test-key",
    };
    const switched = selectVoiceProvider(selectVoiceProvider(custom, "openai"), "local");
    expect(switched.endpoint).toBe(custom.endpoint);
    expect(switched.apiKey).toBe(custom.apiKey);
  });

  it("repairs a Grok setup whose protocol and transport were changed independently", () => {
    const settings = selectVoiceProvider(
      {
        ...VOICE_CONNECTION_PRESETS.xai,
        protocol: "openai",
        transport: "webrtc",
        apiKey: "grok-test-key",
      },
      "xai",
    );
    expect(settings.protocol).toBe("xai");
    expect(settings.transport).toBe("websocket");
    expect(settings.endpoint).toBe(VOICE_CONNECTION_PRESETS.xai.endpoint);
    expect(settings.apiKey).toBe("grok-test-key");
  });
});
