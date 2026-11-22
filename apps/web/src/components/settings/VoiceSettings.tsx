import { msg } from "gt-react";
import { T } from "gt-react";
import { m as resolveCopy } from "../../i18n/messages";
import { useRef } from "react";
import { VOICE_CONNECTION_PRESETS, type VoiceConnectionSettings } from "@t3tools/contracts";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { Textarea } from "../ui/textarea";
import { useSettingsScope } from "./SettingsScopeContext";
import { DraftInput } from "../ui/draft-input";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function VoiceSettings() {
  const value = useScopedSettings((settings) => settings.voiceConnection);
  const instructions = useScopedSettings((settings) => settings.voiceInstructions);
  const instructionsMixed = useScopedSettingsMixed(["voiceInstructions"]);
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => target.environmentId).join(",");
  const instructionsEdited = useRef(false);
  const update = useUpdateScopedSettings();
  const patch = (next: Partial<VoiceConnectionSettings>) =>
    update({ voiceConnection: { ...value, ...next } });
  return (
    <SettingsSection id="voice-conversation" title={resolveCopy(msg("Voice conversation"))}>
      <SettingsRow
        title={resolveCopy(msg("Talk to T3"))}
        serverScoped
        settingKeys={["voiceConnection"]}
        description={resolveCopy(
          msg(
            "Have a spoken conversation that can create projects, operate threads, and report progress. Audio and requested project/thread context go to your chosen voice provider.",
          ),
        )}
        control={
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
            aria-label={resolveCopy(msg("Enable voice conversation"))}
          />
        }
      />
      <SettingsRow
        title={resolveCopy(msg("Conversation engine"))}
        serverScoped
        settingKeys={["voiceConnection"]}
        description={resolveCopy(
          msg(
            "A realtime voice provider needs an API key. A coding agent uses your existing subscription and answers from its own thread. The browser transcribes and speaks.",
          ),
        )}
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
              <SelectItem value="realtime">
                <T>Realtime voice provider</T>
              </SelectItem>
              <SelectItem value="agent">
                <T>Coding agent (no API key)</T>
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title={resolveCopy(msg("Saved instructions"))}
        serverScoped
        settingKeys={["voiceInstructions"]}
        description={resolveCopy(
          msg(
            "Your voice assistant uses these instructions at each session start. Edit or clear them here. Devices connected to this environment share them.",
          ),
        )}
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={`${scopeKey}:${instructionsMixed}:${instructions}`}
            aria-label={resolveCopy(msg("Saved voice instructions"))}
            defaultValue={instructionsMixed ? "" : instructions}
            placeholder={
              instructionsMixed
                ? resolveCopy(msg("Mixed. Enter instructions for all selected environments."))
                : resolveCopy(msg("Act as the COO of my company."))
            }
            rows={4}
            maxLength={16000}
            onChange={() => {
              instructionsEdited.current = true;
            }}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (instructionsEdited.current && (instructionsMixed || next !== instructions))
                update({ voiceInstructions: next });
              instructionsEdited.current = false;
            }}
          />
        </div>
      </SettingsRow>
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
        title={resolveCopy(msg("Connection preset"))}
        serverScoped
        settingKeys={["voiceConnection"]}
        description={resolveCopy(
          msg(
            "Start with a provider or customize a compatible local server below. Applying a preset clears the saved API key.",
          ),
        )}
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
        title={resolveCopy(msg("Realtime protocol"))}
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
              <SelectItem value="openai">
                <T>OpenAI compatible</T>
              </SelectItem>
              <SelectItem value="xai">
                <T>xAI compatible</T>
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title={resolveCopy(msg("Audio transport"))}
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
              <SelectItem value="webrtc">
                <T>WebRTC (SDP)</T>
              </SelectItem>
              <SelectItem value="websocket">
                <T>WebSocket (PCM16, 24 kHz)</T>
              </SelectItem>
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
