import { describe, expect, it } from "vite-plus/test";
import { VOICE_CONNECTION_PRESETS } from "@t3tools/contracts";
import { updateVoiceTranscript, voiceSessionConfiguration } from "./session.ts";
import { voiceInstructions } from "./tools.ts";

const connection = { ...VOICE_CONNECTION_PRESETS.xai, instructions: "", clientSecret: "ephemeral" };

describe("voice session history", () => {
  it("loads saved preferences for both realtime providers even without history", () => {
    for (const preset of [connection, { ...VOICE_CONNECTION_PRESETS.openai, clientSecret: "" }]) {
      const session = voiceSessionConfiguration({ ...preset, instructions: "Act as my COO." });
      expect(session.instructions).toContain("Act as my COO.");
      expect(session.instructions.startsWith(voiceInstructions)).toBe(true);
      expect(voiceSessionConfiguration({ ...preset, instructions: "" }).instructions).toBe(
        voiceInstructions,
      );
    }
  });
  it("bounds history when appending and preserves surrounding rows when revising", () => {
    const first = { id: "first", speaker: "You", text: "Hi" };
    const second = { id: "second", speaker: "T3", text: "Hello" };
    const third = { id: "third", speaker: "You", text: "Continue" };
    const lines = updateVoiceTranscript([first, second], third, 2);
    expect(lines).toEqual([second, third]);
    expect(updateVoiceTranscript(lines, { ...second, text: "Hello!" }, 2)).toEqual([
      { ...second, text: "Hello!" },
      third,
    ]);
    expect(updateVoiceTranscript([first], second, 1)).toEqual([second]);
  });
  it("starts a first conversation with the plain instructions", () => {
    expect(voiceSessionConfiguration(connection).instructions).toBe(voiceInstructions);
  });
  it("carries earlier conversations into a new session, keeping the most recent", () => {
    const history = [
      { speaker: "You", text: `ancient ${"x".repeat(7000)}` },
      { speaker: "You", text: "Rename the billing project" },
      { speaker: "T3", text: "Done, it is now Invoices." },
    ];
    for (const preset of [
      connection,
      { ...VOICE_CONNECTION_PRESETS.openai, instructions: "", clientSecret: "" },
    ]) {
      const { instructions } = voiceSessionConfiguration(preset, history);
      expect(instructions.startsWith(voiceInstructions)).toBe(true);
      expect(
        instructions.endsWith("You: Rename the billing project\nT3: Done, it is now Invoices."),
      ).toBe(true);
      expect(instructions).not.toContain("ancient");
    }
  });
});
