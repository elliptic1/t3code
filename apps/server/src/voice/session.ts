import { VoiceSessionError, type VoiceConnectionSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const ClientSecret = Schema.Struct({ value: Schema.String.check(Schema.isMinLength(1)) });

const encodeSession = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeClientSecret = Schema.decodeUnknownEffect(ClientSecret);

export function validateVoiceConnection(settings: VoiceConnectionSettings): void {
  const endpoint = new URL(settings.endpoint);
  const protocols = settings.transport === "webrtc" ? ["https:", "http:"] : ["wss:", "ws:"];
  if (!protocols.includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("Voice endpoint does not match the selected transport.");
  }
  if (settings.tokenEndpoint) {
    const token = new URL(settings.tokenEndpoint);
    if (!["https:", "http:"].includes(token.protocol) || token.username || token.password) {
      throw new Error("Use an HTTP or HTTPS client-secret endpoint.");
    }
  } else if (settings.apiKey) {
    throw new Error(
      "Authenticated connections require a client-secret endpoint; permanent keys never go to the browser.",
    );
  }
}

export const createVoiceSession = Effect.fn("voice.createSession")(function* (
  settings: VoiceConnectionSettings,
  fetcher: typeof fetch = fetch,
) {
  if (!settings.enabled)
    return yield* new VoiceSessionError({
      message: "Enable voice conversation in Settings → Integrations.",
    });
  yield* Effect.try({
    try: () => validateVoiceConnection(settings),
    catch: (cause) =>
      new VoiceSessionError({
        message: cause instanceof Error ? cause.message : "Invalid voice connection.",
      }),
  });
  let clientSecret = "";
  if (settings.tokenEndpoint) {
    const body = yield* encodeSession(
      settings.protocol === "openai"
        ? {
            expires_after: { anchor: "created_at", seconds: 60 },
            session: {
              type: "realtime",
              model: settings.model,
              ...(settings.voice ? { audio: { output: { voice: settings.voice } } } : {}),
            },
          }
        : { expires_after: { seconds: 60 } },
    ).pipe(
      Effect.mapError(
        () => new VoiceSessionError({ message: "Invalid voice session configuration." }),
      ),
    );
    const data = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetcher(settings.tokenEndpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          headers: {
            "Content-Type": "application/json",
            ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
          },
          body,
        });
        if (!response.ok)
          throw new Error(
            `Voice provider rejected session creation (HTTP ${response.status}). Check the endpoint, model, and API key in Settings.`,
          );
        return (await response.json()) as unknown;
      },
      catch: (cause) =>
        new VoiceSessionError({
          message:
            cause instanceof Error && cause.message.startsWith("Voice provider rejected")
              ? cause.message
              : "Could not create the voice session. Check the connection settings and server network access.",
        }),
    });
    const secret = yield* decodeClientSecret(data).pipe(
      Effect.mapError(
        () =>
          new VoiceSessionError({ message: "Voice provider returned an invalid client secret." }),
      ),
    );
    clientSecret = secret.value;
  }
  return {
    protocol: settings.protocol,
    transport: settings.transport,
    endpoint: settings.endpoint,
    transcriptionModel: settings.transcriptionModel,
    model: settings.model,
    voice: settings.voice,
    clientSecret,
  };
});
