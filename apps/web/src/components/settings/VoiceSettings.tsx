import { useRef } from "react";
import {
  type VoiceConnectionSettings,
  type VoiceConnectionProfile,
  type VoiceProviderId,
} from "@t3tools/contracts";
import {
  selectVoiceProvider,
  selectVoiceTransport,
  updateVoiceConnection,
  voiceProviderId,
  voiceTransportOptions,
} from "@t3tools/shared/voiceSettings";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
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
  const saveConnection = useAtomCommand(serverEnvironment.updateSettings);
  const queued = useRef(
    new Map<string, { value: VoiceConnectionSettings; promise: Promise<unknown> }>(),
  );
  const changeConnection = (
    change: (value: VoiceConnectionSettings) => VoiceConnectionSettings,
  ) => {
    for (const target of targets) {
      const previous = queued.current.get(target.environmentId);
      const next = change(previous?.value ?? target.settings.voiceConnection);
      const promise = (previous?.promise ?? Promise.resolve())
        .then(() =>
          saveConnection({
            environmentId: target.environmentId,
            input: { patch: { voiceConnection: next } },
          }),
        )
        .finally(() => {
          if (queued.current.get(target.environmentId)?.value === next)
            queued.current.delete(target.environmentId);
        });
      queued.current.set(target.environmentId, { value: next, promise });
    }
  };
  const patch = (
    next: Partial<VoiceConnectionProfile> &
      Partial<Pick<VoiceConnectionSettings, "enabled" | "mode">>,
  ) => changeConnection((current) => updateVoiceConnection(current, next));
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
      <SettingsRow
        title="Saved instructions"
        serverScoped
        settingKeys={["voiceInstructions"]}
        description="Your voice assistant remembers these instructions at every session start. Ask her to remember a role or preference, or edit them here. Clear them to forget. Shared across devices connected to this environment."
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={`${scopeKey}:${instructionsMixed}:${instructions}`}
            aria-label="Saved voice instructions"
            defaultValue={instructionsMixed ? "" : instructions}
            placeholder={
              instructionsMixed
                ? "Mixed. Enter instructions for all selected environments."
                : "Act as the COO of my company."
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
      {value.mode === "agent" ? null : (
        <VoiceProviderSettings
          value={value}
          patch={patch}
          selectProvider={(id) => changeConnection((current) => selectVoiceProvider(current, id))}
          selectTransport={(transport) =>
            changeConnection((current) => selectVoiceTransport(current, transport))
          }
        />
      )}
    </SettingsSection>
  );
}

function VoiceProviderSettings({
  value,
  patch,
  selectProvider,
  selectTransport,
}: {
  value: VoiceConnectionSettings;
  patch: (next: Partial<VoiceConnectionProfile>) => void;
  selectProvider: (id: VoiceProviderId) => void;
  selectTransport: (transport: VoiceConnectionSettings["transport"]) => void;
}) {
  const provider = voiceProviderId(value);
  const providerLabel =
    provider === "xai" ? "Grok" : provider === "openai" ? "OpenAI" : "Local / custom";
  return (
    <>
      <SettingsRow
        title="Voice provider"
        serverScoped
        settingKeys={["voiceConnection"]}
        description="Each provider keeps its own API key, model, voice, and connection settings. Select a provider to switch; changes are saved automatically."
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
                variant={provider === id ? "secondary" : "outline"}
                aria-pressed={provider === id}
                onClick={() => selectProvider(id)}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />
      {provider === "local" ? (
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
      ) : null}
      <SettingsRow
        title="Connection method"
        description={
          provider === "xai"
            ? "Grok uses WebSocket. The correct connection is selected automatically."
            : provider === "openai"
              ? "WebRTC is recommended for OpenAI on phones and browsers. Changing this also updates the OpenAI connection endpoint."
              : "Choose the connection method supported by your custom server."
        }
        serverScoped
        settingKeys={["voiceConnection"]}
        control={
          <Select
            value={value.transport}
            onValueChange={(transport) => {
              if (transport === "webrtc" || transport === "websocket") selectTransport(transport);
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {voiceTransportOptions(provider).map((transport) => (
                <SelectItem key={transport} value={transport}>
                  {transport === "webrtc"
                    ? provider === "openai"
                      ? "WebRTC (recommended)"
                      : "WebRTC"
                    : "WebSocket"}
                </SelectItem>
              ))}
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
          key={`${provider}:${key}`}
          title={`${providerLabel} ${title.toLowerCase()}`}
          description={
            key === "apiKey"
              ? `Saved separately for ${providerLabel}. Enter a key once, then switch providers without re-entering it. Clear to remove only this provider’s key.`
              : description
          }
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
