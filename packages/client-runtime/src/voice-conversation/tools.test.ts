import { describe, expect, it, vi } from "vite-plus/test";
import { createVoiceToolRunner, voiceTools } from "./tools.ts";
import { updateVoiceTranscript } from "./session.ts";

describe("voice tool dispatch", () => {
  it("can save and clear preferences, and rejects oversized instructions", async () => {
    const execute = vi.fn(async () => ({}));
    const run = createVoiceToolRunner(execute);
    for (const [call_id, instructions] of [
      ["save", "Act as my COO."],
      ["clear", ""],
    ]) {
      expect(
        JSON.parse(
          await run({
            call_id: call_id!,
            name: "update_voice_settings",
            arguments: JSON.stringify({ instructions }),
          }),
        ).ok,
      ).toBe(true);
      expect(execute).toHaveBeenLastCalledWith({ action: "update_voice_settings", instructions });
    }
    const output = JSON.parse(
      await run({
        call_id: "large",
        name: "update_voice_settings",
        arguments: JSON.stringify({ instructions: "x".repeat(16001) }),
      }),
    );
    expect(output.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("requires a task when the voice provider creates a thread", async () => {
    const execute = vi.fn(async (_action: unknown) => ({ threadId: "created" }));
    const run = createVoiceToolRunner(execute);
    expect(voiceTools.find((tool) => tool.name === "create_thread")?.parameters.required).toEqual([
      "projectId",
      "title",
      "message",
    ]);
    for (const [index, message] of [undefined, "", "   "].entries()) {
      const output = JSON.parse(
        await run({
          call_id: `empty-${index}`,
          name: "create_thread",
          arguments: JSON.stringify({ projectId: "project", title: "Fix billing", message }),
        }),
      );
      expect(output.ok).toBe(false);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("submits the conversation's task with creation once, including after a repeated event", async () => {
    const execute = vi.fn(async (_action: unknown) => ({ threadId: "created" }));
    const run = createVoiceToolRunner(execute);
    const call = {
      call_id: "launch",
      name: "create_thread",
      arguments: JSON.stringify({
        projectId: "project",
        title: "Fix billing",
        message: "Investigate the checkout error we discussed and fix it.",
      }),
    };
    expect(JSON.parse(await run(call))).toEqual({ ok: true, result: { threadId: "created" } });
    await run(call);
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      action: "create_thread",
      projectId: "project",
      title: "Fix billing",
      message: "Investigate the checkout error we discussed and fix it.",
    });
  });

  it("executes a duplicated mutation once, even while the first call is pending", async () => {
    let finish!: (value: unknown) => void;
    const execute = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const run = createVoiceToolRunner(execute);
    const call = { call_id: "one", name: "create_project", arguments: '{"name":"My app"}' };
    const first = run(call);
    const second = run(call);
    expect(execute).toHaveBeenCalledTimes(1);
    finish({ projectId: "created" });
    expect(await first).toBe(await second);
  });
  it("validates arguments and cannot be redirected by an action in the argument object", async () => {
    const execute = vi.fn(async () => ({}));
    const run = createVoiceToolRunner(execute);
    expect(
      JSON.parse(await run({ call_id: "bad", name: "send_message", arguments: '{"threadId":"a"}' }))
        .ok,
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    await run({
      call_id: "good",
      name: "list_projects",
      arguments: '{"action":"create_project","name":"injected"}',
    });
    expect(execute).toHaveBeenCalledWith({ action: "list_projects" });
  });
  it("reports tool errors instead of claiming success, and remembers failed calls", async () => {
    const execute = vi.fn(async () => {
      throw new Error("Thread not found");
    });
    const run = createVoiceToolRunner(execute);
    const call = { call_id: "failed", name: "open_thread", arguments: '{"threadId":"missing"}' };
    expect(JSON.parse(await run(call))).toEqual({ ok: false, error: "Thread not found" });
    await run(call);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown tools and invalid JSON without running an action", async () => {
    const execute = vi.fn();
    const run = createVoiceToolRunner(execute);
    await run({ call_id: "a", name: "approve_everything", arguments: "{}" });
    await run({ call_id: "b", name: "list_threads", arguments: "not json" });
    expect(execute).not.toHaveBeenCalled();
  });
});

import { createVoiceConversationController } from "./tools.ts";

function harness(execute = vi.fn(async (_action: unknown) => ({ accepted: true }))) {
  const abort = new AbortController();
  const send = vi.fn();
  const onTranscript = vi.fn();
  const controller = createVoiceConversationController({
    signal: abort.signal,
    send,
    execute,
    onTranscript,
    onError: vi.fn(),
    onStatus: vi.fn(),
  });
  const event = (value: unknown) => controller.onEvent(JSON.stringify(value));
  const completed = (id: string) =>
    event({
      type: "response.done",
      response: {
        status: "completed",
        output: [{ type: "function_call", call_id: id, name: "list_projects", arguments: "{}" }],
      },
    });
  return { controller, event, completed, abort, send, execute, onTranscript };
}

describe("voice conversation lifecycle", () => {
  it("replaces revised transcripts and ignores replays while keeping separate utterances", () => {
    const h = harness();
    let lines: Array<{ id: string; speaker: string; text: string }> = [];
    h.onTranscript.mockImplementation((speaker, text, id) => {
      lines = updateVoiceTranscript(lines, { speaker, text, id }, 40);
    });
    const transcript = (item_id: string, text: string) =>
      h.event({
        type: "conversation.item.input_audio_transcription.completed",
        item_id,
        transcript: text,
      });
    transcript("greeting", "Hey, what's");
    transcript("greeting", "Hey what's up?");
    const revised = lines;
    transcript("greeting", "Hey what's up?");
    expect(lines).toBe(revised);
    expect(lines.map((line) => line.text)).toEqual(["Hey what's up?"]);
    transcript("another-greeting", "Hey what's up?");
    expect(lines.map((line) => line.text)).toEqual(["Hey what's up?", "Hey what's up?"]);
    transcript("greeting", "Hey, what's up?");
    expect(lines.map((line) => line.text)).toEqual(["Hey, what's up?", "Hey what's up?"]);
  });

  it("uses the same assistant transcript identity for both protocol event names", () => {
    const h = harness();
    for (const type of [
      "response.output_audio_transcript.done",
      "response.audio_transcript.done",
    ]) {
      h.event({ type, item_id: "reply", content_index: 0, transcript: "Hello" });
    }
    expect(h.onTranscript.mock.calls).toEqual([
      ["T3", "Hello", "T3:reply:0"],
      ["T3", "Hello", "T3:reply:0"],
    ]);
    h.event({
      type: "response.output_audio_transcript.done",
      item_id: "reply",
      content_index: 1,
      transcript: "How can I help?",
    });
    expect(h.onTranscript).toHaveBeenLastCalledWith("T3", "How can I help?", "T3:reply:1");
  });

  it("accepts providers that omit transcript identities", () => {
    const h = harness();
    h.event({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hello" });
    expect(h.onTranscript).toHaveBeenCalledWith("You", "Hello", undefined);
  });

  it("continues once after all tools, ignoring repeated provider events", async () => {
    const h = harness();
    h.completed("a");
    h.completed("a");
    await h.controller.whenIdle();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls.map(([event]) => event.type)).toEqual([
      "conversation.item.create",
      "response.create",
    ]);
  });
  it("does not start queued tools or send results after the conversation ends", async () => {
    const h = harness();
    h.completed("a");
    h.abort.abort();
    await h.controller.whenIdle();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("does not execute a cancelled model response", async () => {
    const h = harness();
    h.event({
      type: "response.done",
      response: {
        status: "cancelled",
        output: [{ type: "function_call", call_id: "x", name: "list_projects", arguments: "{}" }],
      },
    });
    await h.controller.whenIdle();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("defers a tool continuation while the model is answering a newer utterance", async () => {
    let finish!: (value: { accepted: boolean }) => void;
    const h = harness(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    h.completed("a");
    await Promise.resolve();
    h.event({ type: "response.created" });
    finish({ accepted: true });
    await h.controller.whenIdle();
    expect(h.send.mock.calls.map(([event]) => event.type)).toEqual(["conversation.item.create"]);
    h.event({ type: "response.done", response: { status: "completed", output: [] } });
    expect(h.send.mock.calls.at(-1)?.[0]).toEqual({ type: "response.create" });
  });
  it("waits for a response to finish before announcing application updates", () => {
    const h = harness();
    h.event({ type: "response.created" });
    h.controller.notify("Build needs approval");
    expect(h.send).not.toHaveBeenCalled();
    h.event({ type: "response.done", response: { status: "completed", output: [] } });
    expect(h.send.mock.calls).toHaveLength(2);
    expect(JSON.stringify(h.send.mock.calls)).toContain("Build needs approval");
  });
});

it("waits for voice playback to drain before continuing after a tool call", async () => {
  const h = harness();
  h.event({ type: "output_audio_buffer.started" });
  h.completed("audio-tool");
  await h.controller.whenIdle();
  expect(h.send.mock.calls.map(([event]) => event.type)).toEqual(["conversation.item.create"]);
  h.event({ type: "output_audio_buffer.stopped" });
  expect(h.send.mock.calls.at(-1)?.[0]).toEqual({ type: "response.create" });
});
