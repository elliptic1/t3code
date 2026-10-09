import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  acquireVoiceInputSession,
  releaseVoiceInputSession,
} from "@t3tools/client-runtime/voice-input";
import { VOICE_CONNECTION_PRESETS } from "@t3tools/contracts";
import { connectNativeVoice } from "./nativeSession";
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  activity: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  remove: vi.fn(),
  awake: vi.fn(),
  sleep: vi.fn(),
  backgroundStart: vi.fn(),
  backgroundStop: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("./backgroundSession", () => ({ startVoiceBackgroundSession: mocks.backgroundStart }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "session" }));
vi.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: mocks.awake,
  deactivateKeepAwake: mocks.sleep,
}));
vi.mock("react-native-audio-api", () => ({
  AudioManager: {
    requestRecordingPermissions: mocks.permission,
    setAudioSessionActivity: mocks.activity,
    setAudioSessionOptions: vi.fn(),
    observeAudioInterruptions: vi.fn(),
    addSystemEventListener: () => ({ remove: mocks.remove }),
  },
}));
vi.mock("./connection", () => ({ connectVoice: mocks.connect }));
function input(abort = new AbortController()) {
  return {
    signal: abort.signal,
    connection: { ...VOICE_CONNECTION_PRESETS.openai, clientSecret: "temporary" },
    execute: vi.fn(),
    onTranscript: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue("Granted");
  mocks.backgroundStart.mockResolvedValue(mocks.backgroundStop);
  mocks.backgroundStop.mockResolvedValue(undefined);
  mocks.activity.mockResolvedValue(undefined);
  mocks.awake.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.connect.mockResolvedValue({ close: mocks.close, mute: vi.fn(), notify: vi.fn() });
});
describe("native audio session ownership", () => {
  it("prevents simultaneous dictation and conversation, then releases the lease on end", async () => {
    const session = await connectNativeVoice(input());
    expect(acquireVoiceInputSession()).toBeNull();
    await session.close();
    expect(mocks.activity).toHaveBeenLastCalledWith(false);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.backgroundStop).toHaveBeenCalledOnce();
    expect(mocks.awake).not.toHaveBeenCalled();
    const next = acquireVoiceInputSession();
    expect(next).not.toBeNull();
    releaseVoiceInputSession(next);
  });
  it("refuses conversation while dictation owns the microphone", async () => {
    const dictation = acquireVoiceInputSession();
    try {
      await expect(connectNativeVoice(input())).rejects.toThrow("Finish dictation");
      expect(mocks.permission).not.toHaveBeenCalled();
    } finally {
      releaseVoiceInputSession(dictation);
    }
  });
  it("releases ownership after permission denial", async () => {
    mocks.permission.mockResolvedValue("Denied");
    await expect(connectNativeVoice(input())).rejects.toThrow("Microphone access");
    expect(mocks.connect).not.toHaveBeenCalled();
    const next = acquireVoiceInputSession();
    expect(next).not.toBeNull();
    releaseVoiceInputSession(next);
  });
  it("waits for native teardown before another capture can start", async () => {
    let finish!: () => void;
    mocks.close.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const session = await connectNativeVoice(input());
    const closing = session.close();
    expect(acquireVoiceInputSession()).toBeNull();
    finish();
    await closing;
    const next = acquireVoiceInputSession();
    expect(next).not.toBeNull();
    releaseVoiceInputSession(next);
  });
  it("cancellation during audio activation restores audio without starting a transport", async () => {
    let activated!: () => void;
    let started!: () => void;
    const activation = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.activity.mockImplementation((active) =>
      active
        ? new Promise<void>((resolve) => {
            activated = resolve;
            started();
          })
        : Promise.resolve(),
    );
    const abort = new AbortController();
    const pending = connectNativeVoice(input(abort));
    await activation;
    abort.abort();
    activated();
    await expect(pending).rejects.toThrow();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.activity).toHaveBeenLastCalledWith(false);
    const next = acquireVoiceInputSession();
    expect(next).not.toBeNull();
    releaseVoiceInputSession(next);
  });
});

it("releases the service when connecting fails", async () => {
  mocks.connect.mockRejectedValue(new Error("offline"));
  await expect(connectNativeVoice(input())).rejects.toThrow("offline");
  expect(mocks.backgroundStop).toHaveBeenCalledOnce();
});

it("releases the service even when transport teardown fails", async () => {
  const session = await connectNativeVoice(input());
  mocks.close.mockRejectedValue(new Error("teardown"));
  await expect(session.close()).rejects.toThrow("teardown");
  expect(mocks.backgroundStop).toHaveBeenCalledOnce();
  const next = acquireVoiceInputSession();
  expect(next).not.toBeNull();
  releaseVoiceInputSession(next);
});

it("cancellation during service startup releases it before allowing another session", async () => {
  let finish!: (release: () => Promise<void>) => void;
  let started!: () => void;
  const starting = new Promise<void>((resolve) => {
    started = resolve;
  });
  mocks.backgroundStart.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
        started();
      }),
  );
  const abort = new AbortController();
  const pending = connectNativeVoice(input(abort));
  await starting;
  abort.abort();
  expect(acquireVoiceInputSession()).toBeNull();
  finish(mocks.backgroundStop);
  await expect(pending).rejects.toThrow();
  expect(mocks.backgroundStop).toHaveBeenCalledOnce();
  expect(mocks.connect).not.toHaveBeenCalled();
  const next = acquireVoiceInputSession();
  expect(next).not.toBeNull();
  releaseVoiceInputSession(next);
});
