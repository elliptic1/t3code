import {
  VOICE_CONNECTION_PRESETS,
  type VoiceConnectionProfile,
  type VoiceConnectionSettings,
  type VoiceProviderId,
} from "@t3tools/contracts";

export function voiceProviderId(settings: VoiceConnectionSettings): VoiceProviderId {
  if (settings.provider) return settings.provider;
  try {
    const host = new URL(settings.endpoint).hostname;
    if (host === "api.x.ai") return "xai";
    if (host === "api.openai.com") return "openai";
  } catch {
    /* A custom endpoint can be edited before it is valid. */
  }
  return "local";
}

function voiceConnectionProfile(settings: VoiceConnectionProfile): VoiceConnectionProfile {
  const { protocol, transport, endpoint, tokenEndpoint, transcriptionModel, model, voice, apiKey } =
    settings;
  return { protocol, transport, endpoint, tokenEndpoint, transcriptionModel, model, voice, apiKey };
}

export function updateVoiceConnection(
  settings: VoiceConnectionSettings,
  patch: Partial<VoiceConnectionProfile> &
    Partial<Pick<VoiceConnectionSettings, "enabled" | "mode">>,
): VoiceConnectionSettings {
  const provider = voiceProviderId(settings);
  const next = { ...settings, ...patch, provider };
  return { ...next, profiles: { ...settings.profiles, [provider]: voiceConnectionProfile(next) } };
}

export function selectVoiceProvider(
  settings: VoiceConnectionSettings,
  provider: VoiceProviderId,
): VoiceConnectionSettings {
  const current = updateVoiceConnection(settings, {});
  const next = {
    ...current,
    ...voiceConnectionProfile(current.profiles?.[provider] ?? VOICE_CONNECTION_PRESETS[provider]),
    provider,
  };
  if (provider !== "local") next.protocol = provider;
  return provider === "xai" && next.transport !== "websocket"
    ? selectVoiceTransport(next, "websocket")
    : next;
}

export function voiceTransportOptions(provider: VoiceProviderId) {
  return provider === "xai" ? (["websocket"] as const) : (["webrtc", "websocket"] as const);
}

export function selectVoiceTransport(
  settings: VoiceConnectionSettings,
  transport: VoiceConnectionSettings["transport"],
) {
  const provider = voiceProviderId(settings);
  if (!voiceTransportOptions(provider).some((option) => option === transport)) return settings;
  const endpoint =
    provider === "openai"
      ? transport === "webrtc"
        ? VOICE_CONNECTION_PRESETS.openai.endpoint
        : "wss://api.openai.com/v1/realtime"
      : provider === "xai"
        ? VOICE_CONNECTION_PRESETS.xai.endpoint
        : settings.endpoint;
  return updateVoiceConnection(settings, { transport, endpoint });
}
