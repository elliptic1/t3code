import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { VOICE_CONNECTION_PRESETS } from "@t3tools/contracts";
import { connectVoice } from "./connection";

const track = { enabled: true, stop: vi.fn() };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const getUserMedia = vi.fn();
const closePeer = vi.fn();
const pauseAudio = vi.fn();
const send = vi.fn();
class Channel extends EventTarget {
  readyState = "open";
  send = send;
}
class Peer extends EventTarget {
  connectionState = "connected";
  channel = new Channel();
  close = closePeer;
  addTrack = vi.fn();
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { sdp: "offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.channel.dispatchEvent(new Event("open"));
  }
}
function input(abort = new AbortController()) {
  return {
    connection: { ...VOICE_CONNECTION_PRESETS.openai, clientSecret: "ephemeral" },
    signal: abort.signal,
    execute: vi.fn(async () => ({})),
    onTranscript: vi.fn(),
    onError: vi.fn(),
    onStatus: vi.fn(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  track.enabled = true;
  getUserMedia.mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal(
    "Audio",
    class {
      autoplay = false;
      srcObject: unknown;
      pause = pauseAudio;
      async play() {}
    },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("answer")));
});
afterEach(() => vi.unstubAllGlobals());

describe("WebRTC voice lifecycle", () => {
  it("configures the tools, supports mute, and releases microphone and playback on end", async () => {
    const abort = new AbortController();
    const connection = await connectVoice(input(abort));
    expect(send).toHaveBeenCalledOnce();
    expect(
      JSON.parse(send.mock.calls[0]![0]).session.tools.some(
        (tool: { name: string }) => tool.name === "create_thread",
      ),
    ).toBe(true);
    connection.mute(true);
    expect(track.enabled).toBe(false);
    connection.mute(false);
    expect(track.enabled).toBe(true);
    abort.abort();
    expect(track.stop).toHaveBeenCalled();
    expect(closePeer).toHaveBeenCalled();
    expect(pauseAudio).toHaveBeenCalled();
  });
  it("releases a microphone grant that arrives after cancellation", async () => {
    let grant!: (value: typeof stream) => void;
    getUserMedia.mockReturnValue(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );
    const abort = new AbortController();
    const pending = connectVoice(input(abort));
    abort.abort();
    grant(stream);
    await expect(pending).rejects.toThrow();
    expect(track.stop).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not request microphone access for an already-ended conversation", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(connectVoice(input(abort))).rejects.toThrow();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("cleans up after a rejected SDP exchange", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("provider details", { status: 401 }));
    await expect(connectVoice(input())).rejects.toThrow("HTTP 401");
    expect(track.stop).toHaveBeenCalled();
    expect(closePeer).toHaveBeenCalled();
  });
  it("cleans up when microphone permission is denied", async () => {
    getUserMedia.mockRejectedValue(new Error("Permission denied"));
    await expect(connectVoice(input())).rejects.toThrow("Permission denied");
    expect(closePeer).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
