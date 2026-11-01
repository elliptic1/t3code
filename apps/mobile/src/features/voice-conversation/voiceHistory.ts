import type { VoiceHistoryLine } from "@t3tools/client-runtime/voice-conversation/session";
import * as Schema from "effect/Schema";
import { writeFileAtomically } from "../../lib/atomic-file";

export const VOICE_HISTORY_LINES = 40;

const decodeHistory = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ id: Schema.String, speaker: Schema.String, text: Schema.String })),
  ),
);
export type StoredVoiceLine = VoiceHistoryLine & { readonly id: string };

// ponytail: history lives on this device, so another phone or the web app starts its own.
// Move it behind a server RPC when conversations need to follow the user across clients.
async function historyFile() {
  const { File, Paths } = await import("expo-file-system");
  return new File(Paths.document, "voice-history.json");
}

/** The voice conversation is app-wide, so there is one history rather than one per environment. */
export async function loadVoiceHistory(): Promise<ReadonlyArray<StoredVoiceLine>> {
  try {
    const file = await historyFile();
    return file.exists ? decodeHistory(await file.text()).slice(-VOICE_HISTORY_LINES) : [];
  } catch {
    return [];
  }
}

export async function saveVoiceHistory(lines: ReadonlyArray<StoredVoiceLine>): Promise<void> {
  await writeFileAtomically(await historyFile(), JSON.stringify(lines.slice(-VOICE_HISTORY_LINES)));
  syncVoiceHistoryToWatch(lines).catch(() => {});
}

/**
 * Mirrors the phone's recent voice transcript to the paired Wear watch over the
 * Wear Data Layer, so a watch-launched session continues with the same memory.
 * The watch reads the same {id, speaker, text} shape back into its session.
 */
async function syncVoiceHistoryToWatch(lines: ReadonlyArray<StoredVoiceLine>): Promise<void> {
  let bridge: { setVoiceHistory: (historyJson: string) => Promise<void> } | null = null;
  try {
    const { requireNativeModule } = require("expo-modules-core");
    bridge = requireNativeModule("T3WearDataLayer");
  } catch {}
  if (!bridge) return;
  await bridge.setVoiceHistory(JSON.stringify(lines.slice(-VOICE_HISTORY_LINES)));
}
