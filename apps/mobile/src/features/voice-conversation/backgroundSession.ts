import { Platform } from "react-native";
import { requireNativeModule } from "expo";

/** Android owns CPU/background microphone access without keeping the display on. */
export async function startVoiceBackgroundSession() {
  if (Platform.OS !== "android") return async () => {};
  const service = requireNativeModule<{ start(): Promise<void>; stop(): Promise<void> }>(
    "T3VoiceSession",
  );
  try {
    await service.start();
  } catch (error) {
    await service.stop();
    throw error;
  }
  return () => service.stop();
}
