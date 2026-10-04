import { VOICE_CONNECTION_PRESETS, type VoiceConnectionSettings } from "@t3tools/contracts";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { DraftInput } from "../ui/draft-input";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function VoiceSettings() {
  const value = useScopedSettings((settings) => settings.voiceConnection);
  const update = useUpdateScopedSettings();
  const patch = (next: Partial<VoiceConnectionSettings>) =>
    update({ voiceConnection: { ...value, ...next } });
  return (
    <SettingsSection id="voice-conversation" title="Voice conversation">
      <SettingsRow
        title="Talk to T3"
        serverScoped
        settingKeys={["voiceConnection"]}
        description="Have a spoken conversation that can create projects, operate threads, and report progress. Audio and requested project/thread context go to your chosen voice provider."
        control={
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
            aria-label="Enable voice conversation"
          />
        }
      />
      <SettingsRow
        title="Conversation engine"
        serverScoped
        settingKeys={["voiceConnection"]}
        description="A realtime voice provider answers instantly and needs an API key. A coding agent uses your existing provider subscription instead: this browser transcribes and speaks, and the agent answers one turn at a time from its own thread."
        control={
          <Select
            value={value.mode}
            onValueChange={(mode) => {
              if (mode === "realtime" || mode === "agent") patch({ mode });
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="realtime">Realtime voice provider</SelectItem>
              <SelectItem value="agent">Coding agent (no API key)</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {value.mode === "agent" ? null : <VoiceProviderSettings value={value} patch={patch} />}
    </SettingsSection>
  );
}

function VoiceProviderSettings({
  value,
  patch,
}: {
  value: VoiceConnectionSettings;
  patch: (next: Partial<VoiceConnectionSettings>) => void;
}) {
  return (
    <>
      <SettingsRow
        title="Connection preset"
        serverScoped
        settingKeys={["voiceConnection"]}
        description="Start with a provider or customize a compatible local server below. Applying a preset clears the saved API key."
        control={
          <div className="flex gap-1">
            {(
              [
                ["openai", "OpenAI"],
                ["xai", "Grok"],
                ["local", "Local / custom"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant="outline"
                onClick={() => patch({ ...VOICE_CONNECTION_PRESETS[id], enabled: value.enabled })}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />
      <SettingsRow
        title="Realtime protocol"
        serverScoped
        settingKeys={["voiceConnection"]}
        control={
          <Select
            value={value.protocol}
            onValueChange={(protocol) => {
              if (protocol === "openai" || protocol === "xai") patch({ protocol });
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="openai">OpenAI compatible</SelectItem>
              <SelectItem value="xai">xAI compatible</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Audio transport"
        serverScoped
        settingKeys={["voiceConnection"]}
        control={
          <Select
            value={value.transport}
            onValueChange={(transport) => {
              if (transport === "webrtc" || transport === "websocket") patch({ transport });
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="webrtc">WebRTC (SDP)</SelectItem>
              <SelectItem value="websocket">WebSocket (PCM16, 24 kHz)</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {(
        [
          [
            "endpoint",
            "Connection endpoint",
            "Reached from this device. Use HTTPS/WSS for remote access; localhost refers to the device running this UI.",
          ],
          [
            "tokenEndpoint",
            "Client-secret endpoint",
            "Reached from the T3 server. Leave blank for a local server without authentication.",
          ],
          [
            "model",
            "Voice model",
            "Exact model ID accepted by your voice server. Leave blank to use a local server's default.",
          ],
          [
            "voice",
            "Voice",
            "Voice ID accepted by your model. Leave blank for the provider default.",
          ],
          [
            "apiKey",
            "API key",
            "Stored in the environment's secret store. Only short-lived client credentials reach the voice connection. Clear this field to remove the key.",
          ],
        ] as const
      ).map(([key, title, description]) => (
        <SettingsRow
          key={key}
          title={title}
          description={description}
          serverScoped
          settingKeys={["voiceConnection"]}
          control={
            <DraftInput
              size="sm"
              className="w-72"
              aria-label={title}
              type={key === "apiKey" ? "password" : "text"}
              autoComplete="off"
              value={value[key]}
              onCommit={(text) => patch({ [key]: text.trim() })}
            />
          }
        />
      ))}
    </>
  );
}
