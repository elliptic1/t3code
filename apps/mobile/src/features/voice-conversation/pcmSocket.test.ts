import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { VOICE_CONNECTION_PRESETS } from "@t3tools/contracts";
import { connectPcmSocket } from "./pcmSocket";
const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
  capture: undefined as
    | undefined
    | ((event: {
        buffer: { sampleRate: number; getChannelData: () => Float32Array };
        numFrames: number;
      }) => void),
  playback: vi.fn(),
  stopPlayback: vi.fn(),
}));
vi.mock("react-native-audio-api", () => ({
  AudioRecorder: class {
    onAudioReady(_options: unknown, callback: typeof mocks.capture) {
      mocks.capture = callback;
      return { status: "success" };
    }
    clearOnAudioReady() {
      mocks.capture = undefined;
    }
    onError() {}
    clearOnError() {}
    start = mocks.start;
    stop = mocks.stop;
  },
  AudioContext: class {
    state = "running";
    currentTime = 0;
    destination = {};
    async resume() {}
    close = mocks.close;
    createBuffer(_channels: number, length: number, rate: number) {
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: mocks.playback,
        stop: mocks.stopPlayback,
      };
    }
  },
}));
let created: Promise<Socket>;
let onCreated: (socket: Socket) => void;
class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn();
  close = vi.fn();
  constructor(
    readonly url: URL,
    readonly protocols: string[],
  ) {
    super();
    onCreated(this);
  }
  event(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}
function input(abort = new AbortController()) {
  return {
    connection: { ...VOICE_CONNECTION_PRESETS.xai, clientSecret: "temporary" },
    signal: abort.signal,
    onEvent: vi.fn(),
    onError: vi.fn(),
  };
}
async function open(options = input()) {
  const pending = connectPcmSocket(options);
  const socket = await created;
  socket.dispatchEvent(new Event("open"));
  return { socket, connection: await pending, options };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.start.mockResolvedValue({ status: "success" });
  mocks.stop.mockResolvedValue({ status: "success" });
  mocks.close.mockResolvedValue(undefined);
  created = new Promise((resolve) => {
    onCreated = resolve;
  });
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => vi.unstubAllGlobals());
describe("native PCM voice socket", () => {
  it("authenticates with a temporary token, encodes signed little-endian PCM, and mutes upload", async () => {
    const { connection, socket } = await open();
    expect(socket.protocols).toEqual(["xai-client-secret.temporary"]);
    const samples = {
      buffer: { sampleRate: 24000, getChannelData: () => new Float32Array([-1, 0, 1]) },
      numFrames: 3,
    };
    mocks.capture?.(samples);
    const event = JSON.parse(socket.send.mock.calls[0]![0]);
    expect(event.type).toBe("input_audio_buffer.append");
    expect(Array.from(atob(event.audio), (char) => char.charCodeAt(0))).toEqual([
      0, 128, 0, 0, 255, 127,
    ]);
    connection.mute(true);
    mocks.capture?.(samples);
    expect(socket.send).toHaveBeenCalledOnce();
    await connection.close();
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("plays streamed audio and truncates unheard speech when the user interrupts", async () => {
    const { connection, socket, options } = await open();
    socket.event({
      type: "response.output_audio.delta",
      delta: btoa("\0\0\0\0"),
      item_id: "speech",
    });
    expect(mocks.playback).toHaveBeenCalledOnce();
    expect(options.onEvent).toHaveBeenCalledWith('{"type":"output_audio_buffer.started"}');
    socket.event({ type: "input_audio_buffer.speech_started" });
    expect(mocks.stopPlayback).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      type: "conversation.item.truncate",
      item_id: "speech",
      audio_end_ms: 0,
    });
    await connection.close();
  });
  it("rejects unsupported capture rates rather than sending audio at the wrong speed", async () => {
    const { connection, socket, options } = await open();
    mocks.capture?.({
      buffer: { sampleRate: 48000, getChannelData: () => new Float32Array(1) },
      numFrames: 1,
    });
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("24 kHz"));
    expect(socket.send).not.toHaveBeenCalled();
    await connection.close();
  });
  it("cleans up the recorder and socket when cancelled before connection", async () => {
    const abort = new AbortController();
    const pending = connectPcmSocket(input(abort));
    const socket = await created;
    abort.abort();
    await expect(pending).rejects.toThrow();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
