import { VoiceButton } from "./VoiceButton";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, View } from "react-native";
import { useNavigation, type NavigationState } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import Constants from "expo-constants";
import type { EnvironmentId } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { T3Wordmark } from "../../components/T3Wordmark";
import { useEnvironments } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { createVoiceActions, createVoiceSessionCommand, voiceResult } from "./actions";
import type { VoiceConnection } from "./connection";

type SessionOwner = { abort: AbortController; connection?: VoiceConnection };

export function VoiceConversation({ state }: { state: NavigationState }) {
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const [open, setOpen] = useState(false);
  const route = state.routes[state.index];
  const params = route?.params as { environmentId?: EnvironmentId; threadId?: string } | undefined;
  const available = environments.filter((entry) => entry.connection.phase === "connected");
  const environmentId = selected ?? params?.environmentId ?? available[0]?.environmentId;
  const environment = available.find((entry) => entry.environmentId === environmentId);
  const insets = useSafeAreaInsets();
  const enabled = environment?.serverConfig?.settings.voiceConnection.enabled ?? false;
  if (!enabled && (selected !== null || open)) {
    setSelected(null);
    setOpen(false);
  }
  if (!environment || !enabled) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: 28,
        bottom: Math.max(insets.bottom, 12) + 88,
        maxWidth: "90%",
      }}
    >
      <VoiceSession
        key={environmentId}
        environmentId={environment.environmentId}
        label={environment.label}
        focusedThread={params?.environmentId === environmentId ? (params?.threadId ?? null) : null}
        open={open}
        setOpen={setOpen}
        onStarted={() => setSelected(environment.environmentId)}
        onStopped={() => setSelected(null)}
      />
    </View>
  );
}

function VoiceSession(props: {
  environmentId: EnvironmentId;
  label: string;
  focusedThread: string | null;
  open: boolean;
  setOpen: (value: boolean) => void;
  onStarted: () => void;
  onStopped: () => void;
}) {
  const navigation = useNavigation();
  const createSession = useAtomCommand(createVoiceSessionCommand, { reportFailure: false });
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<{ message: string; details: string } | null>(null);
  const [lines, setLines] = useState<Array<{ id: string; speaker: string; text: string }>>([]);
  const focused = useRef(props.focusedThread);
  useEffect(() => {
    focused.current = props.focusedThread;
  }, [props.focusedThread]);
  const session = useRef<SessionOwner | null>(null);
  const stop = () => {
    const owner = session.current;
    session.current = null;
    owner?.abort.abort();
    void Promise.resolve(owner?.connection?.close()).catch(() => {});
    setRunning(false);
    setConnected(false);
    setMuted(false);
    setStatus("Ended");
    props.onStopped();
  };
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      // Android keeps active conversations in a microphone foreground service.
      if (state === "background" && Platform.OS !== "android") stopRef.current();
    });
    return () => {
      subscription.remove();
      const owner = session.current;
      session.current = null;
      owner?.abort.abort();
      void Promise.resolve(owner?.connection?.close()).catch(() => {});
    };
  }, []);
  const shells = useThreadShells();
  const observed = useRef(new Map<string, string>());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const thread of shells) {
      if (thread.environmentId !== props.environmentId) continue;
      const detail = thread.runtime?.lastError
        ? `reported an error: ${thread.runtime.lastError}`
        : thread.hasPendingApprovals
          ? "needs approval in the UI"
          : thread.hasPendingUserInput
            ? "needs your input"
            : thread.runtime?.status === "completed"
              ? "finished its turn"
              : "";
      next.set(thread.id, detail);
      if (detail && observed.current.has(thread.id) && observed.current.get(thread.id) !== detail)
        session.current?.connection?.notify(`${thread.title}: ${detail}`);
    }
    observed.current = next;
  }, [shells, props.environmentId]);
  const start = async () => {
    if (session.current) return;
    const owner: SessionOwner = { abort: new AbortController() };
    session.current = owner;
    props.onStarted();
    setRunning(true);
    setStatus("Connecting");
    setError(null);
    setLines([]);
    let transport = "";
    // Details are what "Copy details" puts on the clipboard for a bug report.
    const fail = (message: string, cause?: unknown) => {
      if (session.current !== owner) return;
      stopRef.current();
      setError({
        message,
        details: [
          `T3 Code voice conversation error: ${message}`,
          `Environment: ${props.label}`,
          transport && `Connection: ${transport}`,
          `App: ${Constants.expoConfig?.version ?? "unknown"} on ${Platform.OS} ${Platform.Version}`,
          `Time: ${new Date().toISOString()}`,
          cause instanceof Error && cause.stack,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    };
    const timeout = setTimeout(
      () => fail("Voice connection timed out. Check your connection settings."),
      30000,
    );
    try {
      const connection = voiceResult(
        await createSession({ environmentId: props.environmentId, input: {} }),
      );
      transport = `${connection.protocol} over ${connection.transport}, ${connection.endpoint}, model ${connection.model || "default"}`;
      owner.abort.signal.throwIfAborted();
      const { connectNativeVoice } = await import("./nativeSession");
      owner.connection = await connectNativeVoice({
        connection,
        signal: owner.abort.signal,
        execute: createVoiceActions(
          props.environmentId,
          async (threadId) => {
            navigation.navigate("Thread", { environmentId: props.environmentId, threadId });
            props.setOpen(false);
          },
          () => focused.current,
        ),
        onStatus: (value) => {
          if (session.current === owner) setStatus(value);
        },
        onError: fail,
        onTranscript: (speaker, text) => {
          if (session.current === owner)
            setLines((previous) => [...previous.slice(-39), { id: randomUUID(), speaker, text }]);
        },
      });
      if (owner.abort.signal.aborted) await owner.connection.close();
      else setConnected(true);
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "Could not start voice conversation.", cause);
    } finally {
      clearTimeout(timeout);
    }
  };
  return (
    <>
      {props.open ? (
        <View
          className="rounded-xl border border-border bg-sheet p-4"
          style={{ width: 310, maxWidth: "100%" }}
        >
          <Text className="text-lg text-foreground">Talk to T3</Text>
          <Text className="text-xs text-foreground-muted">{props.label}</Text>
          <Text accessibilityLiveRegion="polite" className="my-2 text-sm text-foreground">
            {muted ? "Microphone muted" : status}
          </Text>
          {error ? (
            <View className="mb-2">
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {error.message}
              </Text>
              <VoiceButton
                label="Copy details"
                onPress={() => copyTextWithHaptic(error.details, { target: "error details" })}
              />
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 180 }} accessibilityLabel="Conversation transcript">
            {lines.map((line) => (
              <Text key={line.id} className="mb-2 text-sm text-foreground">
                {line.speaker}: {line.text}
              </Text>
            ))}
            {!lines.length ? (
              <Text className="text-sm text-foreground-muted">
                Ask about projects, start a thread, or tell an agent what to do. Your provider
                receives audio and requested context.
              </Text>
            ) : null}
          </ScrollView>
          <View className="flex-row flex-wrap gap-2">
            {running ? (
              <>
                <VoiceButton
                  label={muted ? "Unmute" : "Mute"}
                  disabled={!connected}
                  onPress={() => {
                    session.current?.connection?.mute(!muted);
                    setMuted(!muted);
                  }}
                />
                <VoiceButton label="End" onPress={stop} />
              </>
            ) : (
              <VoiceButton label="Start conversation" onPress={() => void start()} />
            )}
            <VoiceButton
              label="Settings"
              onPress={() => {
                props.setOpen(false);
                navigation.navigate("SettingsSheet", {
                  screen: "SettingsContent",
                  params: { screen: "SettingsVoice" },
                });
              }}
            />
            <VoiceButton label="Hide" onPress={() => props.setOpen(false)} />
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={running ? "Show voice conversation" : "Talk to T3"}
        onPress={() => props.setOpen(!props.open)}
        className="mt-3 size-15 self-end rounded-full bg-black shadow-xl shadow-black/50 active:opacity-85"
        style={{ elevation: 12 }}
      >
        {/* Clipped inner layer: iOS drops the shadow of a view that clips its own content. */}
        <View
          className="size-15 items-center justify-center overflow-hidden rounded-full border border-white/20"
          style={{
            experimental_backgroundImage: "linear-gradient(to bottom, #2b2b30 0%, #000 100%)",
          }}
        >
          <T3Wordmark height={18} color="#f4f4f5" />
          <View
            pointerEvents="none"
            className="absolute top-0 right-0 left-0 h-1/2 rounded-t-full"
            style={{
              experimental_backgroundImage:
                "linear-gradient(to bottom, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 100%)",
            }}
          />
        </View>
      </Pressable>
    </>
  );
}
