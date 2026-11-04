import { Platform } from "react-native";
import { startVoiceBackgroundSession } from "./backgroundSession";
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
  let releaseFocus = () => {};
  let releaseBackground = async () => {};
  let preparing = true;
  let opened = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (preparing) return Promise.resolve().then(releaseFocus);
    input.signal.removeEventListener("abort", onAbort);
    closing ??= (async () => {
      try {
        // Yield to keyboard dictation before waiting for native recorder shutdown.
        releaseFocus();
      } finally {
        try {
          await connection?.close();
        } finally {
          try {
            await releaseAudio();
          } finally {
            try {
              await releaseBackground();
            } finally {
              releaseVoiceInputSession(token);
            }
          }
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
    releaseBackground = await startVoiceBackgroundSession();
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
    const awake = Platform.OS === "android" ? Promise.resolve() : activateKeepAwakeAsync(tag);
    void awake.catch(() => {});
    const interruption = AudioManager.addSystemEventListener("interruption", ({ type }) => {
      if (type === "began") input.onError("Voice was interrupted. Start again when ready.");
    });
    let observing = true;
    releaseFocus = () => {
      if (!observing) return;
      observing = false;
      try {
        interruption.remove();
      } finally {
        AudioManager.observeAudioInterruptions(false);
      }
    };
    releaseAudio = async () => {
      try {
        await AudioManager.setAudioSessionActivity(false);
      } finally {
        if (Platform.OS !== "android")
          await awake.then(() => deactivateKeepAwake(tag)).catch(() => {});
      }
    };
    // Conversations can last minutes. Exclusive transient focus can prevent
    // system speech recognition from starting while T3 runs in the background.
    AudioManager.observeAudioInterruptions("gain");
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
