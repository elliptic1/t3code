import { describe, expect, it } from "vite-plus/test";
import { VOICE_CONNECTION_PRESETS } from "@t3tools/contracts";
import { voiceSessionConfiguration } from "./session.ts";
import { voiceInstructions } from "./tools.ts";
const connection = { ...VOICE_CONNECTION_PRESETS.xai, instructions: "", clientSecret: "ephemeral" };
describe("saved voice instructions", () => {
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
});
