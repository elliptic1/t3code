import { describe, expect, it, vi } from "vite-plus/test";
import { createVoiceToolRunner } from "./tools.ts";

describe("voice tool dispatch", () => {
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
  const controller = createVoiceConversationController({
    signal: abort.signal,
    send,
    execute,
    onTranscript: vi.fn(),
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
  return { controller, event, completed, abort, send, execute };
}

describe("voice conversation lifecycle", () => {
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
