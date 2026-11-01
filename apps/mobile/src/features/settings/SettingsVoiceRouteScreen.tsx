import { useState } from "react";
import { ScrollView, Switch, TextInput, View } from "react-native";
import { type VoiceConnectionSettings, type EnvironmentId } from "@t3tools/contracts";
import {
  selectVoiceProvider,
  selectVoiceTransport,
  updateVoiceConnection,
  voiceProviderId,
  voiceTransportOptions,
} from "@t3tools/shared/voiceSettings";
import { AppText as Text } from "../../components/AppText";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { voiceResult } from "../voice-conversation/actions";
import { VoiceButton } from "../voice-conversation/VoiceButton";

export function SettingsVoiceRouteScreen() {
  const { availableTargets } = useSettingsEnvironmentFilter();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const target =
    availableTargets.find((entry) => entry.environmentId === selected) ?? availableTargets[0];
  return (
    <SettingsScreen title="Voice conversation">
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <SettingsSection title="Environment">
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
            Connect to an environment to configure voice.
          </Text>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function VoiceSettings({ target }: { target: SettingsTarget }) {
  const [draft, setDraft] = useState<VoiceConnectionSettings>(
    target.serverConfig.settings.voiceConnection,
  );
  const provider = voiceProviderId(draft);
  const providerLabel =
    provider === "xai" ? "Grok" : provider === "openai" ? "OpenAI" : "Local / custom";
  const [instructions, setInstructions] = useState(target.serverConfig.settings.voiceInstructions);
  const [instructionsChanged, setInstructionsChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const save = async (connection = draft) => {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      voiceResult(
        await update({
          environmentId: target.environmentId,
          input: {
            patch: {
              ...(instructionsChanged ? { voiceInstructions: instructions.trim() } : {}),
              voiceConnection: updateVoiceConnection(connection, {}),
            },
          },
        }),
      );
      const redact = (value: string) => (value ? "••••••" : "");
      setDraft({
        ...connection,
        apiKey: redact(connection.apiKey),
        profiles: Object.fromEntries(
          Object.entries(connection.profiles ?? {}).map(([id, profile]) => [
            id,
            { ...profile, apiKey: redact(profile.apiKey) },
          ]),
        ),
      });
      setInstructionsChanged(false);
      setMessage(
        `${voiceProviderId(connection) === "xai" ? "Grok" : voiceProviderId(connection) === "openai" ? "OpenAI" : "Local / custom"} settings saved`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save voice settings.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <View className="gap-3 pt-4">
      <Text className="text-sm text-foreground-muted">
        Credentials are stored on this T3 server and shared with your connected devices. Voice audio
        goes to your configured provider. Local addresses must be reachable from your phone.
      </Text>
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground">Enable voice conversation</Text>
        <Switch
          accessibilityLabel="Enable voice conversation"
          value={draft.enabled}
          disabled={saving}
          onValueChange={(enabled) => {
            const next = updateVoiceConnection(draft, { enabled });
            setDraft(next);
            void save(next);
          }}
        />
      </View>
      <Text className="text-foreground">Voice provider</Text>
      <Text className="text-sm text-foreground-muted">
        Each provider keeps its own key, model, voice, and connection settings. Tap a provider to
        save your changes and switch immediately.
      </Text>
      <View className="flex-row flex-wrap">
        {(["openai", "xai", "local"] as const).map((id) => (
          <VoiceButton
            key={id}
            label={`${provider === id ? "✓ " : ""}${id === "local" ? "Local / custom" : id === "xai" ? "Grok" : "OpenAI"}`}
            disabled={saving}
            onPress={() => {
              const next = selectVoiceProvider(draft, id);
              setDraft(next);
              void save(next);
            }}
          />
        ))}
      </View>
      {provider === "local" ? (
        <>
          <Text className="text-foreground">Protocol</Text>
          <View className="flex-row">
            {(["openai", "xai"] as const).map((protocol) => (
              <VoiceButton
                key={protocol}
                label={`${draft.protocol === protocol ? "✓ " : ""}${protocol}`}
                disabled={saving}
                onPress={() => setDraft(updateVoiceConnection(draft, { protocol }))}
              />
            ))}
          </View>
        </>
      ) : null}
      <Text className="text-foreground">{providerLabel} connection method</Text>
      <Text className="text-sm text-foreground-muted">
        {provider === "xai"
          ? "Grok uses WebSocket. No connection method change is needed when switching providers."
          : provider === "openai"
            ? "WebRTC is recommended for phones and browsers. The connection endpoint updates automatically when you change this."
            : "Choose the connection method supported by your server."}
      </Text>
      <View className="flex-row">
        {voiceTransportOptions(provider).map((transport) => (
          <VoiceButton
            key={transport}
            label={`${draft.transport === transport ? "✓ " : ""}${transport === "webrtc" ? (provider === "openai" ? "WebRTC (recommended)" : "WebRTC") : "WebSocket"}`}
            disabled={saving}
            onPress={() => setDraft(selectVoiceTransport(draft, transport))}
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
          ["apiKey", `${providerLabel} API key`],
        ] as const
      ).map(([field, label]) => (
        <View key={`${provider}:${field}`} className="gap-1">
          <Text className="text-sm text-foreground">
            {field === "apiKey" ? label : `${providerLabel} ${label.toLowerCase()}`}
          </Text>
          {field === "apiKey" ? (
            <Text className="text-sm text-foreground-muted">
              {draft.apiKey
                ? draft.apiKey === "••••••"
                  ? "Key saved for this provider. Leave unchanged to keep it, or enter a replacement."
                  : "Key entered. Save or switch providers to keep it."
                : "No API key saved for this provider."}
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel={label}
            value={field === "apiKey" && draft.apiKey === "••••••" ? "" : draft[field]}
            placeholder={field === "apiKey" && draft.apiKey ? "Saved key (unchanged)" : undefined}
            editable={!saving}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={field === "apiKey"}
            className="min-h-11 rounded-lg border border-border px-3 text-foreground"
            onChangeText={(value) => {
              setDraft(updateVoiceConnection(draft, { [field]: value }));
            }}
          />
        </View>
      ))}
      <View className="gap-1">
        <Text className="text-foreground">Saved instructions</Text>
        <Text className="text-sm text-foreground-muted">
          Ask your voice assistant to remember a role or preference for every session, or edit it
          here. Clear these instructions to forget. Shared across devices connected to this
          environment.
        </Text>
        <TextInput
          accessibilityLabel="Saved voice instructions"
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
        label={`Remove ${providerLabel} API key`}
        disabled={saving}
        onPress={() => {
          setDraft(updateVoiceConnection(draft, { apiKey: "" }));
          setMessage("Save to remove the existing key.");
        }}
      />
      <VoiceButton
        label={saving ? "Saving…" : "Save voice settings"}
        disabled={saving}
        onPress={() => void save()}
      />
      <Text accessibilityLiveRegion="polite" className="text-sm text-foreground">
        {message}
      </Text>
    </View>
  );
}
