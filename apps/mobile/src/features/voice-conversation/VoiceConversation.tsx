import { VoiceButton } from "./VoiceButton";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, View } from "react-native";
import { useNavigation, type NavigationState } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import type { EnvironmentId } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useEnvironments } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
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
  if (!environment) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: 16,
        bottom: Math.max(insets.bottom, 12) + 60,
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
  const [error, setError] = useState<string | null>(null);
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
      if (state === "background") stopRef.current();
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
    const fail = (message: string) => {
      if (session.current === owner) {
        stopRef.current();
        setError(message);
      }
    };
    const timeout = setTimeout(
      () => fail("Voice connection timed out. Check your connection settings."),
      30000,
    );
    try {
      const connection = voiceResult(
        await createSession({ environmentId: props.environmentId, input: {} }),
      );
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
      fail(cause instanceof Error ? cause.message : "Could not start voice conversation.");
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
            <Text accessibilityRole="alert" className="mb-2 text-sm text-danger-foreground">
              {error}
            </Text>
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
        className="mt-2 size-12 self-end items-center justify-center rounded-full bg-primary"
      >
        <SymbolView name="mic" size={22} tintColorClassName="accent-primary-foreground" />
      </Pressable>
    </>
  );
}
