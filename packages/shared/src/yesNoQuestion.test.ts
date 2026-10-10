import { describe, expect, it } from "vite-plus/test";

import { endsWithYesNoQuestion } from "./yesNoQuestion.js";

describe("endsWithYesNoQuestion", () => {
  it.each([
    "Should I push this to main?",
    "The build passed.\n\nDo you want me to install it on your phone?",
    "I found two stale branches. Want me to delete them?",
    "Tests are green. **Shall I open the PR?**",
    "That leaves the desktop app. If so, should I rebuild it now?",
    "Before I merge, do you want me to run the tests?",
    "Okay, is that what you meant?",
    "Should I go ahead or not?",
  ])("offers yes/no for %j", (text) => {
    expect(endsWithYesNoQuestion(text)).toBe(true);
  });

  it.each([
    "",
    "Done. The build is on your phone.",
    "Which branch should I use?",
    "What do you want to call it?",
    "Should I use the launchd agent or a scheduled task?",
    "Do you want A, B, or C?",
    "Which one? Should I push?",
    "Should I push?\n\nI'll wait for your answer.",
  ])("does not offer yes/no for %j", (text) => {
    expect(endsWithYesNoQuestion(text)).toBe(false);
  });
});
