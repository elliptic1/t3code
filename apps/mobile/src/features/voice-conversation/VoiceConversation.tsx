import { msg } from "gt-react-native";
import { T } from "gt-react-native";
import { m as resolveCopy } from "../../i18n/messages";
/* oxlint-disable t3code/no-unreasoned-state-sync -- these effects run the live voice session: microphone, WebRTC, and speech playback outside React */
import { VoiceButton } from "./VoiceButton";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openSettings } from "../settings/settings-navigation";
import {
  AppState,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type GestureResponderHandlers,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type AnimatedStyle,
} from "react-native-reanimated";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useNavigation, type NavigationState } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import Constants from "expo-constants";
import { VOICE_HISTORY_LINES, type EnvironmentId } from "@t3tools/contracts";
import {
  createVoiceHistorySync,
  updateVoiceTranscript,
} from "@t3tools/client-runtime/voice-conversation/session";
import { AppText as Text } from "../../components/ui/AppText";
import { T3Wordmark } from "../../components/T3Wordmark";
import { useEnvironments } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import {
  createVoiceActions,
  createVoiceSessionCommand,
  syncVoiceHistoryCommand,
  voiceResult,
} from "./actions";
import type { VoiceConnection } from "./connection";
import { syncVoiceHistoryToWatch } from "./voiceHistory";
import { useVoiceFabClearance } from "./voiceFabClearance";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { voiceFabDestination } from "./voiceFabPhysics";

const FAB_SIZE = 60;

type SessionOwner = { abort: AbortController; connection?: VoiceConnection };

export function VoiceConversation({ state }: { state: NavigationState }) {
  const { environments, isReady } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const [open, setOpen] = useState(false);
  const route = state.routes[state.index];
  const params = route?.params as { environmentId?: EnvironmentId; threadId?: string } | undefined;
  // Voice is app-wide: any connected environment with voice turned on can host the session,
  // so an environment without it (the open thread's, or the first in the list) must not hide it.
  const available = environments.filter(
    (entry) =>
      entry.connection.phase === "connected" &&
      (entry.serverConfig?.settings.voiceConnection.enabled ?? false),
  );
  const environment =
    available.find((entry) => entry.environmentId === (selected ?? params?.environmentId)) ??
    (selected === null ? available[0] : undefined);
  const environmentId = environment?.environmentId;
  const voiceEnabled = environments.some(
    (entry) => entry.serverConfig?.settings.voiceConnection.enabled,
  );
  const settingsKnown = environments.every(
    (entry) => entry.serverConfig !== null && entry.serverConfig !== undefined,
  );
  useEffect(() => {
    if (Platform.OS !== "android" || !isReady || (!voiceEnabled && !settingsKnown)) return;
    const update = () => {
      if (AppState.currentState !== "active") return;
      void import("expo")
        .then(({ requireNativeModule }) =>
          requireNativeModule<{ setConnectionReady: (enabled: boolean) => Promise<void> }>(
            "T3WearDataLayer",
          ).setConnectionReady(voiceEnabled),
        )
        .catch(() => console.warn("Could not update the background voice connection"));
    };
    update();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") update();
    });
    return () => subscription.remove();
  }, [voiceEnabled, settingsKnown, isReady]);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const clearance = useVoiceFabClearance();
  const toolbar = useToolbarLayout();
  const keyboardHeight = useKeyboardState((keyboard) => keyboard.height);
  const [placement, setPlacement] = useState({ side: "right", vertical: "bottom" });
  // Screens without published bottom controls keep clearance above tab bars.
  const baseline = keyboardHeight + (clearance ?? Math.max(insets.bottom, 12) + 76) + 12;
  const topDock = toolbar.paddingTop + toolbar.height + toolbar.paddingBottom + 12;
  const bounds = {
    left: insets.left + 16,
    right: Math.max(insets.left + 16, window.width - insets.right - FAB_SIZE - 16),
    top: topDock,
    bottom: Math.max(topDock, window.height - baseline - FAB_SIZE),
  };
  const x = useSharedValue(bounds.right);
  const y = useSharedValue(bounds.bottom);
  const start = useSharedValue({ x: bounds.right, y: bounds.bottom });
  const velocity = useSharedValue({ x: 0, y: 0 });
  const { left, right, top, bottom } = bounds;
  // Synchronize docking with changing native window, keyboard, and screen-control bounds.
  useLayoutEffect(() => {
    const spring = { damping: 18, stiffness: 180, mass: 0.7 };
    x.set(
      withSpring(placement.side === "right" ? right : left, {
        ...spring,
        velocity: velocity.get().x,
      }),
    );
    y.set(
      withSpring(placement.vertical === "bottom" ? bottom : top, {
        ...spring,
        velocity: velocity.get().y,
      }),
    );
    velocity.set({ x: 0, y: 0 });
  }, [placement, left, right, top, bottom, x, y, velocity]);
  const dragStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [
      { translateX: Math.max(left - 8, Math.min(right + 8, x.get())) },
      { translateY: Math.max(top - 8, Math.min(bottom + 8, y.get())) },
    ],
  }));
  const openDown = placement.vertical === "top";
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 8,
    onPanResponderGrant: () => {
      setOpen(false);
      cancelAnimation(x);
      cancelAnimation(y);
      start.set({ x: x.get(), y: y.get() });
    },
    onPanResponderMove: (_, gesture) => {
      x.set(Math.max(left, Math.min(right, start.get().x + gesture.dx)));
      y.set(Math.max(top, Math.min(bottom, start.get().y + gesture.dy)));
    },
    onPanResponderRelease: (_, gesture) => {
      velocity.set({
        x: Math.max(-1800, Math.min(1800, gesture.vx * 1000)),
        y: Math.max(-1800, Math.min(1800, gesture.vy * 1000)),
      });
      setPlacement(
        voiceFabDestination(
          { x: x.get(), y: y.get() },
          { x: gesture.vx * 1000, y: gesture.vy * 1000 },
          bounds,
        ),
      );
    },
    onPanResponderTerminate: () => {
      velocity.set({ x: 0, y: 0 });
      setPlacement({ ...placement });
    },
  });
  const panelWidth = Math.min(310, window.width - insets.left - insets.right - 32);
  const panelStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [
      {
        translateX:
          Math.max(left - 8, Math.min(right + 8, x.get())) -
          (placement.side === "right" ? panelWidth - FAB_SIZE : 0),
      },
      {
        translateY:
          Math.max(top - 8, Math.min(bottom + 8, y.get())) + (openDown ? FAB_SIZE + 12 : -12),
      },
      { translateY: openDown ? "0%" : "-100%" },
    ],
  }));
  const enabled = environment !== undefined;
  if (!enabled && (selected !== null || open)) {
    setSelected(null);
    setOpen(false);
  }
  if (!environment || !enabled) return null;
  return (
    <VoiceSession
      fabHandlers={panResponder.panHandlers}
      fabStyle={dragStyle}
      panelStyle={panelStyle}
      panelWidth={panelWidth}
      key={environmentId}
      environmentId={environment.environmentId}
      label={environment.label}
      focusedThread={params?.environmentId === environmentId ? (params?.threadId ?? null) : null}
      open={open}
      setOpen={setOpen}
      onStarted={() => setSelected(environment.environmentId)}
      onStopped={() => setSelected(null)}
    />
  );
}

function VoiceSession(props: {
  fabHandlers: GestureResponderHandlers;
  fabStyle: AnimatedStyle<ViewStyle>;
  panelStyle: AnimatedStyle<ViewStyle>;
  panelWidth: number;
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
  const syncHistory = useAtomCommand(syncVoiceHistoryCommand, { reportFailure: false });
  const [historySync] = useState(() =>
    createVoiceHistorySync(
      async (lines, reset) => {
        const stored = voiceResult(
          await syncHistory({
            environmentId: props.environmentId,
            input: { lines, ...(reset ? { reset: true } : {}) },
          }),
        );
        void syncVoiceHistoryToWatch(stored).catch(() => {});
        return stored;
      },
      () =>
        setError({
          message: resolveCopy(
            msg("Voice history could not be saved. End the conversation to retry."),
          ),
          details: "Voice history sync failed.",
        }),
    ),
  );
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
    setStatus(resolveCopy(msg("Saving conversation")));
    void historySync.flush().then(
      () => setStatus(resolveCopy(msg("Ended"))),
      () => {
        setStatus(resolveCopy(msg("History not saved")));
        setError({
          message: resolveCopy(
            msg(
              "Voice history could not be saved. Check your connection before switching devices.",
            ),
          ),
          details: "Voice history sync failed.",
        });
      },
    );
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
      void historySync.flush().catch(() => {});
    };
  }, [historySync]);
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
    const transcriptSessionId = randomUUID();
    session.current = owner;
    props.onStarted();
    setRunning(true);
    setStatus(resolveCopy(msg("Connecting")));
    setError(null);
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
      const history = await historySync.load();
      owner.abort.signal.throwIfAborted();
      setLines([...history]);
      const connection = voiceResult(
        await createSession({ environmentId: props.environmentId, input: {} }),
      );
      transport = `${connection.protocol} over ${connection.transport}, ${connection.endpoint}, model ${connection.model || "default"}`;
      owner.abort.signal.throwIfAborted();
      const { connectNativeVoice } = await import("./nativeSession");
      owner.connection = await connectNativeVoice({
        connection,
        history,
        signal: owner.abort.signal,
        execute: createVoiceActions(
          props.environmentId,
          async (threadId) => {
            // oxlint-disable-next-line t3code/no-ambiguous-detail-navigation -- voice results open the thread in place
            navigation.navigate("Thread", { environmentId: props.environmentId, threadId });
            props.setOpen(false);
          },
          () => focused.current,
        ),
        onStatus: (value) => {
          if (session.current === owner) setStatus(value);
        },
        onError: fail,
        onTranscript: (speaker, text, id) => {
          if (session.current !== owner) return;
          const line = {
            id: `${transcriptSessionId}:${id ?? randomUUID()}`,
            speaker,
            text: text.slice(-16000),
          };
          historySync.record(line);
          setLines((previous) => updateVoiceTranscript(previous, line, VOICE_HISTORY_LINES));
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
    <View
      collapsable={false}
      pointerEvents="box-none"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
    >
      {/* Keep the native animation target stable when the panel mounts. */}
      <Animated.View
        key="voice-fab"
        pointerEvents="box-none"
        style={[
          { position: "absolute", top: 0, left: 0, width: FAB_SIZE, height: FAB_SIZE },
          props.fabStyle,
        ]}
      >
        <View {...props.fabHandlers}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              running ? resolveCopy(msg("Show voice conversation")) : resolveCopy(msg("Talk to T3"))
            }
            accessibilityHint={resolveCopy(msg("Drag or fling toward a corner to move"))}
            onPress={() => props.setOpen(!props.open)}
            className="items-center justify-center rounded-full border border-foreground/20 bg-card shadow-lg shadow-black/30 active:opacity-85"
            style={{ width: FAB_SIZE, height: FAB_SIZE, elevation: 12 }}
          >
            <T3Wordmark height={18} colorClassName="accent-wordmark" />
          </Pressable>
        </View>
      </Animated.View>
      {props.open ? (
        <Animated.View
          key="voice-panel"
          className="rounded-2xl border border-foreground/20 bg-card p-4 shadow-xl shadow-black/40"
          style={[
            { position: "absolute", top: 0, left: 0, width: props.panelWidth, elevation: 16 },
            props.panelStyle,
          ]}
        >
          <Text className="text-lg text-foreground">
            <T>Talk to T3</T>
          </Text>
          <Text className="text-xs text-foreground-muted">{props.label}</Text>
          <Text accessibilityLiveRegion="polite" className="my-2 text-sm text-foreground">
            {muted ? resolveCopy(msg("Microphone muted")) : status}
          </Text>
          {error ? (
            <View className="mb-2">
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {error.message}
              </Text>
              <VoiceButton
                label={resolveCopy(msg("Copy details"))}
                onPress={() => copyTextWithHaptic(error.details, { target: "error details" })}
              />
            </View>
          ) : null}
          <ScrollView
            style={{ maxHeight: 180 }}
            accessibilityLabel={resolveCopy(msg("Conversation transcript"))}
          >
            {lines.map((line) => (
              <Text key={line.id} className="mb-2 text-sm text-foreground">
                {line.speaker}: {line.text}
              </Text>
            ))}
            {!lines.length ? (
              <Text className="text-sm text-foreground-muted">
                <T>
                  Ask about projects, start a thread, or tell an agent what to do. Your provider
                  receives audio and requested context.
                </T>
              </Text>
            ) : null}
          </ScrollView>
          <View className="flex-row flex-wrap gap-2">
            {running ? (
              <>
                <VoiceButton
                  label={muted ? resolveCopy(msg("Unmute")) : resolveCopy(msg("Mute"))}
                  disabled={!connected}
                  onPress={() => {
                    session.current?.connection?.mute(!muted);
                    setMuted(!muted);
                  }}
                />
                <VoiceButton label="End" onPress={stop} />
              </>
            ) : (
              <>
                <VoiceButton
                  label={
                    lines.length
                      ? resolveCopy(msg("Continue conversation"))
                      : resolveCopy(msg("Start conversation"))
                  }
                  onPress={() => void start()}
                />
                {lines.length ? (
                  <VoiceButton
                    label={resolveCopy(msg("Start fresh"))}
                    onPress={() => {
                      void historySync.reset().then(
                        () => setLines([]),
                        () =>
                          setError({
                            message: resolveCopy(
                              msg(
                                "Could not clear voice history. Check your connection and try again.",
                              ),
                            ),
                            details: "Voice history reset failed.",
                          }),
                      );
                    }}
                  />
                ) : null}
              </>
            )}
            <VoiceButton
              label={resolveCopy(msg("Settings"))}
              onPress={() => {
                props.setOpen(false);
                openSettings(navigation, "SettingsVoice");
              }}
            />
            <VoiceButton label={resolveCopy(msg("Hide"))} onPress={() => props.setOpen(false)} />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
