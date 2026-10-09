import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { startVoiceAgentConversation } from "@t3tools/client-runtime/voice-conversation/agent";
import { randomUUID } from "../lib/utils";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Mic, MicOff, PhoneOff, Settings } from "lucide-react";
import { readThreadShell, useActiveEnvironmentId, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId, useEnvironment } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "../components/ui/button";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { createVoiceActions, createVoiceSessionCommand, voiceResult } from "./actions";
import { createBrowserSpeech } from "./browserSpeech";
import { connectVoice, type VoiceConnection } from "./connection";
import { useVoiceConversationStore } from "./voiceConversationStore";

export function VoiceConversation() {
  const activeId = useActiveEnvironmentId();
  const primaryId = usePrimaryEnvironmentId();
  const environmentId = activeId ?? primaryId;
  return environmentId ? (
    <EnabledVoiceConversation key={environmentId} environmentId={environmentId} />
  ) : null;
}

function EnabledVoiceConversation({ environmentId }: { environmentId: EnvironmentId }) {
  const enabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.voiceConnection.enabled,
  );
  return enabled ? <VoiceConversationSession environmentId={environmentId} /> : null;
}

function VoiceConversationSession({ environmentId }: { environmentId: EnvironmentId }) {
  const environment = useEnvironment(environmentId);
  const mode = useEnvironmentSettings(environmentId, (settings) => settings.voiceConnection.mode);
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const focusedThread = useRef<string | null>(null);
  useEffect(() => {
    focusedThread.current =
      params.environmentId === environmentId ? (params.threadId ?? null) : null;
  }, [params.environmentId, params.threadId, environmentId]);
  const createSession = useAtomCommand(createVoiceSessionCommand, { reportFailure: false });
  const shells = useThreadShells();
  const observed = useRef(new Map<string, string>());
  const session = useRef<{
    abort: AbortController;
    connection?: VoiceConnection | undefined;
  } | null>(null);
  const open = useVoiceConversationStore((state) => state.open);
  const setOpen = useVoiceConversationStore((state) => state.setOpen);
  const running = useVoiceConversationStore((state) => state.running);
  const setRunning = useVoiceConversationStore((state) => state.setRunning);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<
    ReadonlyArray<{ id: string; speaker: string; text: string }>
  >([]);
  const stop = () => {
    session.current?.abort.abort();
    session.current?.connection?.close();
    session.current = null;
    setRunning(false);
    setConnected(false);
    setMuted(false);
    setStatus("Ended");
  };
  useEffect(() => {
    // The composer offers "Talk to T3" only while this session can take it.
    useVoiceConversationStore.getState().setAvailable(true);
    return () => {
      session.current?.abort.abort();
      session.current?.connection?.close();
      session.current = null;
      useVoiceConversationStore.getState().setAvailable(false);
    };
  }, []);
  useEffect(() => {
    const next = new Map<string, string>();
    for (const thread of shells) {
      if (thread.environmentId !== environmentId) continue;
      const state = JSON.stringify([
        thread.runtime?.status,
        thread.runtime?.lastError,
        thread.hasPendingApprovals,
        thread.hasPendingUserInput,
      ]);
      next.set(thread.id, state);
      if (!observed.current.has(thread.id) || observed.current.get(thread.id) === state) continue;
      const detail = thread.runtime?.lastError
        ? `reported an error: ${thread.runtime.lastError}`
        : thread.hasPendingApprovals
          ? "needs approval in the UI"
          : thread.hasPendingUserInput
            ? "needs your input"
            : thread.runtime?.status === "completed"
              ? "finished its turn"
              : null;
      if (detail) session.current?.connection?.notify(`${thread.title}: ${detail}`);
    }
    observed.current = next;
  }, [shells, environmentId]);
  const start = async () => {
    if (session.current || !environmentId) return;
    const owner = {
      abort: new AbortController(),
      connection: undefined as VoiceConnection | undefined,
    };
    session.current = owner;
    setOpen(true);
    setRunning(true);
    setError(null);
    setTranscript([]);
    setStatus("Connecting");
    const timeout = setTimeout(() => {
      if (session.current === owner) {
        stop();
        setError("Voice connection timed out. Check Settings and try again.");
      }
    }, 30_000);
    const shell = (threadId: string | null) =>
      threadId ? readThreadShell(scopeThreadRef(environmentId, ThreadId.make(threadId))) : null;
    const conversation = {
      signal: owner.abort.signal,
      execute: createVoiceActions(
        environmentId,
        async (threadId) => {
          await navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId, threadId },
          });
        },
        () => focusedThread.current,
      ),
      onTranscript: (speaker: "You" | "T3", text: string) => {
        if (session.current === owner)
          setTranscript((lines) => [...lines.slice(-39), { id: randomUUID(), speaker, text }]);
      },
      onStatus: (value: string) => {
        if (session.current === owner) setStatus(value);
      },
      onError: (message: string) => {
        if (session.current === owner) {
          stop();
          setError(message);
        }
      },
    };
    try {
      if (mode === "agent") {
        owner.connection = {
          close: () => {},
          ...startVoiceAgentConversation({
            ...conversation,
            speech: createBrowserSpeech(),
            preferredProjectId: () => shell(focusedThread.current)?.projectId ?? null,
            threadState: (threadId) => {
              const thread = shell(threadId);
              return thread
                ? {
                    running: threadRuntimeIsActive(thread.runtime),
                    error: thread.runtime?.lastError ?? null,
                    needsAttention: thread.hasPendingApprovals || thread.hasPendingUserInput,
                  }
                : null;
            },
          }),
        };
      } else {
        const result = await createSession({ environmentId, input: {} });
        owner.abort.signal.throwIfAborted();
        owner.connection = await connectVoice({ ...conversation, connection: voiceResult(result) });
      }
      if (owner.abort.signal.aborted) owner.connection.close();
      else setConnected(true);
    } catch (cause) {
      if (session.current === owner) {
        stop();
        setError(cause instanceof Error ? cause.message : "Could not start voice conversation.");
      }
    } finally {
      clearTimeout(timeout);
    }
  };
  if (!environmentId || !open) return null;
  return (
    // Opened from the composer's "Talk to T3" button; sits above the composer's Send row.
    <section
      aria-label="Voice conversation"
      className="fixed right-4 bottom-36 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Talk to T3</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Voice settings"
          onClick={() => {
            void navigate({ to: "/settings/integrations" });
          }}
        >
          <Settings className="size-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {environment?.label ?? "Connected environment"}
      </p>
      <p role="status" className="my-2 text-sm">
        {muted ? "Microphone muted" : status}
      </p>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error} Voice setup is in Settings → Integrations.
        </p>
      ) : null}
      {transcript.length ? (
        <div className="mb-3 max-h-52 overflow-y-auto text-sm" aria-label="Conversation transcript">
          {transcript.map((line) => (
            <p key={line.id} className="mb-2">
              <strong>{line.speaker}: </strong>
              {line.text}
            </p>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-xs text-muted-foreground">
          Ask about your projects, start a thread, or tell an agent what to do.{" "}
          {mode === "agent"
            ? "Your browser transcribes your speech, and a coding agent answers from its own thread."
            : "Your configured provider receives the audio and requested context."}
        </p>
      )}
      <div className="flex gap-2">
        {running ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                session.current?.connection?.mute(!muted);
                setMuted(!muted);
              }}
              disabled={!connected}
            >
              {muted ? <Mic className="size-4" /> : <MicOff className="size-4" />}
              {muted ? "Unmute" : "Mute"}
            </Button>
            <Button size="sm" variant="destructive" onClick={stop}>
              <PhoneOff className="size-4" />
              End
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              void start();
            }}
          >
            Start conversation
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {running ? "Hide" : "Close"}
        </Button>
      </div>
    </section>
  );
}
