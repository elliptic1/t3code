import type { VoiceTranscriptLine } from "@t3tools/contracts";
import { VOICE_HISTORY_LINES } from "@t3tools/contracts";

/**
 * Mirrors the phone's recent voice transcript to the paired Wear watch over the
 * Wear Data Layer, so a watch-launched session continues with the same memory.
 * The watch reads the same {id, speaker, text} shape back into its session.
 */
export async function syncVoiceHistoryToWatch(
  lines: ReadonlyArray<VoiceTranscriptLine>,
): Promise<void> {
  let bridge: { setVoiceHistory: (historyJson: string) => Promise<void> } | null = null;
  try {
    const { requireNativeModule } = require("expo-modules-core");
    bridge = requireNativeModule("T3WearDataLayer");
  } catch {}
  if (!bridge) return;
  await bridge.setVoiceHistory(JSON.stringify(lines.slice(-VOICE_HISTORY_LINES)));
}
