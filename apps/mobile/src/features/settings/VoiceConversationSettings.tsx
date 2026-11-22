import { msg } from "gt-react-native";
import { T } from "gt-react-native";
import { m as resolveCopy } from "../../i18n/messages";
import { useState } from "react";
import { Switch, TextInput, View } from "react-native";
import {
  VOICE_CONNECTION_PRESETS,
  type VoiceConnectionSettings,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AppText as Text } from "../../components/ui/AppText";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { SettingsSection } from "./components/SettingsSection";
import { voiceResult } from "../voice-conversation/actions";
import { VoiceButton } from "../voice-conversation/VoiceButton";

export function VoiceConversationSettings() {
  const { availableTargets } = useSettingsEnvironmentFilter();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const target =
    availableTargets.find((entry) => entry.environmentId === selected) ?? availableTargets[0];
  return (
    <>
      <SettingsSection title={resolveCopy(msg("Voice conversation"))}>
        {availableTargets.map((entry) => (
          <VoiceButton
            key={entry.environmentId}
            label={`${entry.environmentId === target?.environmentId ? "✓ " : ""}${entry.label}`}
            onPress={() => setSelected(entry.environmentId)}
          />
        ))}
      </SettingsSection>
      {target ? (
        <VoiceSettings key={target.environmentId} target={target} />
      ) : (
        <Text className="text-foreground-muted">
          <T>Connect to an environment to configure voice.</T>
        </Text>
      )}
    </>
  );
}

function VoiceSettings({ target }: { target: SettingsTarget }) {
  const [draft, setDraft] = useState<VoiceConnectionSettings>({
    ...target.serverConfig.settings.voiceConnection,
    apiKey: "",
  });
  const [instructions, setInstructions] = useState(target.serverConfig.settings.voiceInstructions);
  const [instructionsChanged, setInstructionsChanged] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const setEnabled = async (enabled: boolean) => {
    if (saving) return;
    const previous = draft.enabled;
    setDraft((current) => ({ ...current, enabled }));
    setSaving(true);
    setMessage("");
    try {
      voiceResult(
        await update({
          environmentId: target.environmentId,
          input: {
            patch: {
              voiceConnection: {
                ...target.serverConfig.settings.voiceConnection,
                enabled,
              },
            },
          },
        }),
      );
      setMessage(resolveCopy(msg("Saved")));
    } catch (error) {
      setDraft((current) => ({ ...current, enabled: previous }));
      setMessage(
        error instanceof Error ? error.message : resolveCopy(msg("Could not save voice settings.")),
      );
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const { apiKey, ...connection } = draft;
      voiceResult(
        await update({
          environmentId: target.environmentId,
          input: {
            patch: {
              ...(instructionsChanged ? { voiceInstructions: instructions.trim() } : {}),
              voiceConnection: {
                ...connection,
                apiKey: keyChanged ? apiKey : target.serverConfig.settings.voiceConnection.apiKey,
              },
            },
          },
        }),
      );
      setDraft((current) => ({ ...current, apiKey: "" }));
      setKeyChanged(false);
      setInstructionsChanged(false);
      setMessage(resolveCopy(msg("Saved")));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : resolveCopy(msg("Could not save voice settings.")),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <View className="gap-3 pt-4">
      <Text className="text-sm text-foreground-muted">
        <T>
          Credentials are stored on this T3 server and shared with your connected devices. Voice
          audio goes to your configured provider. Local addresses must be reachable from your phone.
        </T>
      </Text>
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground">
          <T>Enable voice conversation</T>
        </Text>
        <Switch
          accessibilityLabel={resolveCopy(msg("Enable voice conversation"))}
          value={draft.enabled}
          disabled={saving}
          onValueChange={(enabled) => void setEnabled(enabled)}
        />
      </View>
      <View className="flex-row flex-wrap">
        {Object.entries(VOICE_CONNECTION_PRESETS).map(([name, preset]) => (
          <VoiceButton
            key={name}
            label={
              name === "local"
                ? resolveCopy(msg("Local / custom"))
                : name === "xai"
                  ? "Grok"
                  : "OpenAI"
            }
            disabled={saving}
            onPress={() => {
              setDraft({ ...preset, enabled: draft.enabled });
              setKeyChanged(true);
              setMessage(resolveCopy(msg("Preset selected. Enter its API key if required.")));
            }}
          />
        ))}
      </View>
      <Text className="text-foreground">
        <T>Protocol</T>
      </Text>
      <View className="flex-row">
        {(["openai", "xai"] as const).map((protocol) => (
          <VoiceButton
            key={protocol}
            label={`${draft.protocol === protocol ? "✓ " : ""}${protocol}`}
            disabled={saving}
            onPress={() => setDraft({ ...draft, protocol })}
          />
        ))}
      </View>
      <Text className="text-foreground">
        <T>Transport</T>
      </Text>
      <View className="flex-row">
        {(["webrtc", "websocket"] as const).map((transport) => (
          <VoiceButton
            key={transport}
            label={`${draft.transport === transport ? "✓ " : ""}${transport}`}
            disabled={saving}
            onPress={() => setDraft({ ...draft, transport })}
          />
        ))}
      </View>
      {(
        [
          ["endpoint", "Connection endpoint"],
          ["tokenEndpoint", "Client-secret endpoint (optional for local servers)"],
          ["model", "Model"],
          ["voice", "Voice"],
          ["transcriptionModel", "Transcription model (optional)"],
          ["apiKey", "API key (leave blank to keep existing)"],
        ] as const
      ).map(([field, label]) => (
        <View key={field} className="gap-1">
          <Text className="text-sm text-foreground">{label}</Text>
          <TextInput
            accessibilityLabel={label}
            value={draft[field]}
            editable={!saving}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={field === "apiKey"}
            className="min-h-11 rounded-lg border border-border px-3 text-foreground"
            onChangeText={(value) => {
              setDraft({ ...draft, [field]: value });
              if (field === "apiKey") setKeyChanged(true);
            }}
          />
        </View>
      ))}
      <View className="gap-1">
        <Text className="text-foreground">
          <T>Saved instructions</T>
        </Text>
        <Text className="text-sm text-foreground-muted">
          <T>
            Ask your voice assistant to remember a role or preference for every session, or edit it
            here. Clear these instructions to forget. Shared across devices connected to this
            environment.
          </T>
        </Text>
        <TextInput
          accessibilityLabel={resolveCopy(msg("Saved voice instructions"))}
          value={
            instructionsChanged ? instructions : target.serverConfig.settings.voiceInstructions
          }
          editable={!saving}
          multiline
          maxLength={16000}
          className="min-h-24 rounded-lg border border-border px-3 text-foreground"
          onChangeText={(text) => {
            setInstructions(text);
            setInstructionsChanged(true);
          }}
        />
      </View>
      <VoiceButton
        label={resolveCopy(msg("Remove saved API key"))}
        disabled={saving}
        onPress={() => {
          setDraft({ ...draft, apiKey: "" });
          setKeyChanged(true);
          setMessage(resolveCopy(msg("Save to remove the existing key.")));
        }}
      />
      <VoiceButton
        label={saving ? resolveCopy(msg("Saving…")) : resolveCopy(msg("Save voice settings"))}
        disabled={saving}
        onPress={() => void save()}
      />
      <Text accessibilityLiveRegion="polite" className="text-sm text-foreground">
        {message}
      </Text>
    </View>
  );
}
