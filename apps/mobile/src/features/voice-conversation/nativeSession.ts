import { randomUUID } from "expo-crypto";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  acquireVoiceInputSession,
  releaseVoiceInputSession,
} from "@t3tools/client-runtime/voice-input";
import type { connectVoice, VoiceConnection } from "./connection";

/** Holds the dictation capture lease through permission prompts and native teardown. */
export async function connectNativeVoice(
  input: Parameters<typeof connectVoice>[0],
): Promise<VoiceConnection> {
  input.signal.throwIfAborted();
  const token = acquireVoiceInputSession();
  if (!token) throw new Error("Finish dictation before starting a voice conversation.");
  let connection: VoiceConnection | undefined;
  let releaseAudio = async () => {};
  let preparing = true;
  let opened = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (preparing) return Promise.resolve();
    input.signal.removeEventListener("abort", onAbort);
    closing ??= (async () => {
      try {
        await connection?.close();
      } finally {
        try {
          await releaseAudio();
        } finally {
          releaseVoiceInputSession(token);
        }
      }
    })();
    return closing;
  };
  const onAbort = () => {
    void close().catch(() => {});
  };
  input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const { AudioManager } = await import("react-native-audio-api");
    if ((await AudioManager.requestRecordingPermissions()) !== "Granted")
      throw new Error("Microphone access is required. Enable it in your device settings.");
    input.signal.throwIfAborted();
    releaseAudio = () => AudioManager.setAudioSessionActivity(false);
    AudioManager.setAudioSessionOptions({
      iosCategory: "playAndRecord",
      iosMode: "voiceChat",
      iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
      iosNotifyOthersOnDeactivation: true,
    });
    await AudioManager.setAudioSessionActivity(true);
    input.signal.throwIfAborted();
    const tag = `voice-conversation:${randomUUID()}`;
    const awake = activateKeepAwakeAsync(tag);
    void awake.catch(() => {});
    AudioManager.observeAudioInterruptions("gainTransientExclusive");
    const interruption = AudioManager.addSystemEventListener("interruption", ({ type }) => {
      if (type === "began") input.onError("Voice was interrupted. Start again when ready.");
    });
    releaseAudio = async () => {
      interruption.remove();
      AudioManager.observeAudioInterruptions(false);
      try {
        await AudioManager.setAudioSessionActivity(false);
      } finally {
        await awake.then(() => deactivateKeepAwake(tag)).catch(() => {});
      }
    };
    const { connectVoice } = await import("./connection");
    connection = await connectVoice(input);
    input.signal.throwIfAborted();
    opened = true;
    return { ...connection, close };
  } finally {
    preparing = false;
    if (!opened || input.signal.aborted) await close();
  }
}
