import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const VoiceConnectionSettings = Schema.Struct({
  enabled: Schema.Boolean,
  /** "agent" speaks through a coding-agent thread and needs no voice provider or API key. */
  mode: Schema.Literals(["realtime", "agent"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("realtime" as const)),
  ),
  protocol: Schema.Literals(["openai", "xai"]),
  transport: Schema.Literals(["webrtc", "websocket"]),
  endpoint: Schema.String,
  tokenEndpoint: Schema.String,
  transcriptionModel: Schema.String,
  model: Schema.String,
  voice: Schema.String,
  apiKey: Schema.String,
});
export type VoiceConnectionSettings = typeof VoiceConnectionSettings.Type;

export const VOICE_CONNECTION_PRESETS = {
  openai: {
    enabled: false,
    mode: "realtime",
    protocol: "openai",
    transport: "webrtc",
    endpoint: "https://api.openai.com/v1/realtime/calls",
    tokenEndpoint: "https://api.openai.com/v1/realtime/client_secrets",
    transcriptionModel: "gpt-4o-mini-transcribe",
    model: "gpt-realtime-2.1",
    voice: "marin",
    apiKey: "",
  },
  xai: {
    enabled: false,
    mode: "realtime",
    protocol: "xai",
    transport: "websocket",
    endpoint: "wss://api.x.ai/v1/realtime",
    tokenEndpoint: "https://api.x.ai/v1/realtime/client_secrets",
    transcriptionModel: "grok-transcribe",
    model: "grok-voice-latest",
    voice: "eve",
    apiKey: "",
  },
  local: {
    enabled: false,
    mode: "realtime",
    protocol: "openai",
    transport: "websocket",
    endpoint: "ws://localhost:8000/v1/realtime",
    tokenEndpoint: "",
    transcriptionModel: "",
    model: "",
    voice: "",
    apiKey: "",
  },
} as const satisfies Record<string, VoiceConnectionSettings>;

export const VoiceSessionConnection = Schema.Struct({
  protocol: VoiceConnectionSettings.fields.protocol,
  transport: VoiceConnectionSettings.fields.transport,
  endpoint: Schema.String,
  transcriptionModel: Schema.String,
  model: Schema.String,
  voice: Schema.String,
  clientSecret: Schema.String,
});
export type VoiceSessionConnection = typeof VoiceSessionConnection.Type;

export class VoiceSessionError extends Schema.TaggedError<VoiceSessionError>()(
  "VoiceSessionError",
  {
    message: Schema.String,
  },
) {}
