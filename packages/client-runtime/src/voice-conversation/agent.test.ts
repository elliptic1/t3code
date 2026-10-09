// @effect-diagnostics globalTimers:off - The fake agent answers after a delay, like a real turn.
import { describe, expect, it, vi } from "vite-plus/test";
import {
  startVoiceAgentConversation,
  voiceAgentInstructions,
  VOICE_AGENT_THREAD_TITLE,
} from "./agent.ts";
import type { VoiceAction } from "./tools.ts";

/** A fake application: one thread whose agent answers each sent message. */
function harness(options: { existingThread?: boolean; utterances: string[] }) {
  const abort = new AbortController();
  const messages: Array<{ role: string; text: string }> = [];
  const spoken: string[] = [];
  const actions: VoiceAction[] = [];
  let running = false;
  const execute = vi.fn(async (action: VoiceAction): Promise<unknown> => {
    actions.push(action);
    switch (action.action) {
      case "list_threads":
        return {
          active: options.existingThread
            ? [{ id: "voice", title: VOICE_AGENT_THREAD_TITLE, archived: false }]
            : [],
        };
      case "list_projects":
        return [{ id: "first" }, { id: "focused" }];
      case "create_thread":
        return { threadId: "voice" };
      case "send_message":
        messages.push({ role: "user", text: action.message });
        running = true;
        setTimeout(() => {
          messages.push({ role: "assistant", text: "Checking." });
          messages.push({ role: "assistant", text: `Done ${messages.length}.` });
          running = false;
        }, 5);
        return { accepted: true };
      case "read_thread":
        return { messages };
      default:
        throw new Error(`unexpected ${action.action}`);
    }
  });
  const utterances = [...options.utterances];
  const finished = Promise.withResolvers<void>();
  const errors: string[] = [];
  const controller = startVoiceAgentConversation({
    signal: abort.signal,
    execute,
    pollMs: 1,
    preferredProjectId: () => "focused",
    threadState: () => ({ running, error: null, needsAttention: false }),
    speech: {
      listen: async () => {
        const next = utterances.shift();
        if (next === undefined) {
          abort.abort();
          finished.resolve();
          return "";
        }
        return next;
      },
      speak: async (text) => {
        spoken.push(text);
      },
    },
    onTranscript: () => {},
    onStatus: () => {},
    onError: (message) => {
      errors.push(message);
      finished.resolve();
    },
  });
  return { actions, spoken, errors, controller, finished: finished.promise };
}

describe("voice agent conversation", () => {
  it("creates its thread in the focused project and speaks only the agent's final reply", async () => {
    const run = harness({ utterances: ["start a thread", "", "settle it"] });
    await run.finished;
    expect(run.errors).toEqual([]);
    expect(run.actions.find((action) => action.action === "create_thread")).toMatchObject({
      projectId: "focused",
    });
    const sent = run.actions.flatMap((action) =>
      action.action === "send_message" ? [action.message] : [],
    );
    // Instructions ride on the conversation's first message only; silence sends nothing.
    expect(sent).toEqual([
      `${voiceAgentInstructions}\n\nThe user said: start a thread`,
      "settle it",
    ]);
    expect(run.spoken).toEqual(["Done 2.", "Done 5."]);
  });

  it("reuses an existing voice thread and restates the instructions once", async () => {
    const run = harness({ existingThread: true, utterances: ["what is running", "settle it"] });
    await run.finished;
    expect(run.actions.some((action) => action.action === "create_thread")).toBe(false);
    expect(
      run.actions.flatMap((action) => (action.action === "send_message" ? [action.message] : [])),
    ).toEqual([`${voiceAgentInstructions}\n\nThe user said: what is running`, "settle it"]);
  });

  it("announces other threads between turns, but never its own", async () => {
    const run = harness({ existingThread: true, utterances: ["", ""] });
    run.controller.notify(`${VOICE_AGENT_THREAD_TITLE}: finished its turn`);
    run.controller.notify("Billing fix: needs approval in the UI");
    await run.finished;
    expect(run.spoken).toEqual(["Billing fix: needs approval in the UI"]);
  });

  it("reports a missing project instead of listening", async () => {
    const abort = new AbortController();
    const listen = vi.fn(async () => "");
    const error = await new Promise<string>((resolve) => {
      startVoiceAgentConversation({
        signal: abort.signal,
        execute: async (action) => (action.action === "list_threads" ? { active: [] } : []),
        threadState: () => null,
        speech: { listen, speak: async () => {} },
        onTranscript: () => {},
        onStatus: () => {},
        onError: resolve,
      });
    });
    expect(error).toContain("Add a project");
    expect(listen).not.toHaveBeenCalled();
  });
});
