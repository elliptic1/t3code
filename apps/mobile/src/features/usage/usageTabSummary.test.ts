import type { LimitPool } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { usageTabLines } from "./usageTabSummary";

const pool = (driver: string, remaining: readonly number[]) =>
  ({
    driver,
    accounts: [],
    windows: remaining.map((remainingPercent) => ({ remainingPercent })),
  }) as unknown as LimitPool;

describe("usageTabLines", () => {
  it("shows Claude then Codex with each one's tightest window", () => {
    expect(usageTabLines([pool("codex", [80, 35]), pool("claudeAgent", [12, 60])])).toEqual([
      "Claude 12%",
      "Codex 35%",
    ]);
  });

  it("skips providers that report no limits", () => {
    expect(usageTabLines([pool("claudeAgent", []), pool("cursor", [50])])).toEqual([]);
  });
});
