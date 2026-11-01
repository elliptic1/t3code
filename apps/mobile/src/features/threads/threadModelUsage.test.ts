import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadModelUsageRemainingPercent } from "./threadModelUsage";

const environmentId = EnvironmentId.make("thread-environment");
const window = (
  usedPercent: number,
  overrides: Partial<ServerProviderUsageWindow> = {},
): ServerProviderUsageWindow => ({
  id: "primary",
  kind: "session",
  label: "Session",
  usedPercent,
  ...overrides,
});
const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("codex-personal"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-22T18:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt: "2026-10-22T18:00:00Z",
    windows: [window(20), window(65, { id: "secondary", kind: "weekly", label: "Weekly" })],
  },
  ...overrides,
});

describe("threadModelUsageRemainingPercent", () => {
  it("follows the selected login, using its most constrained allowance", () => {
    const personal = provider();
    const work = provider({
      instanceId: ProviderInstanceId.make("codex-work"),
      usageLimits: { checkedAt: personal.checkedAt, windows: [window(90)] },
    });
    const config = { providers: [personal, work], usageLimitSources: [] };
    expect(
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: personal.instanceId, model: "gpt-6.1" },
        config,
      ),
    ).toBe(35);
    expect(
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: work.instanceId, model: "gpt-6.1" },
        config,
      ),
    ).toBe(10);
  });

  it("keeps an exhausted allowance at zero", () => {
    const selected = provider({
      usageLimits: { checkedAt: "2026-10-22T18:00:00Z", windows: [window(100)] },
    });
    expect(
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: selected.instanceId, model: "gpt-6.1" },
        { providers: [selected], usageLimitSources: [] },
      ),
    ).toBe(0);
  });

  it("ignores another Claude model's scoped limit", () => {
    const selected = provider({
      driver: ProviderDriverKind.make("claudeAgent"),
      usageLimits: {
        checkedAt: "2026-10-22T18:00:00Z",
        windows: [
          window(30, { id: "five_hour" }),
          window(50, { id: "seven_day", kind: "weekly" }),
          window(95, { id: "seven_day_opus", kind: "weekly" }),
        ],
      },
    });
    const config = { providers: [selected], usageLimitSources: [] };
    const remaining = (model: string) =>
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: selected.instanceId, model },
        config,
      );
    expect(remaining("claude-sonnet-4-6")).toBe(50);
    expect(remaining("claude-opus-4-6")).toBe(5);
  });

  it("uses only the selected account when reading limits from a proxy", () => {
    const selected = provider({
      auth: { status: "authenticated", email: "todd@example.com", workspaceId: "personal" },
      usageLimits: undefined,
    });
    const account = (email: string, workspaceId: string, usedPercent: number) => ({
      id: `${email}-${workspaceId}`,
      driver: selected.driver,
      email,
      workspaceId,
      usageLimits: { checkedAt: selected.checkedAt, windows: [window(usedPercent)] },
    });
    expect(
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: selected.instanceId, model: "gpt-6.1" },
        {
          providers: [selected],
          usageLimitSources: [
            {
              id: UsageLimitSourceId.make("proxy"),
              kind: "cliproxy",
              label: "Proxy",
              checkedAt: selected.checkedAt,
              accounts: [
                account("TODD@example.com", "personal", 40),
                account("todd@example.com", "work", 90),
                account("other@example.com", "personal", 99),
              ],
            },
          ],
        },
      ),
    ).toBe(60);
  });

  it("keeps Antigravity model families on their own allowance", () => {
    const selected = provider({
      driver: ProviderDriverKind.make("antigravity"),
      usageLimits: {
        checkedAt: "2026-10-22T18:00:00Z",
        windows: [
          window(20, { id: "gemini-pro-5h" }),
          window(30, { id: "gemini-pro-weekly", kind: "weekly" }),
          window(95, { id: "3p-5h" }),
        ],
      },
    });
    const config = { providers: [selected], usageLimitSources: [] };
    expect(
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: selected.instanceId, model: "gemini-3-pro" },
        config,
      ),
    ).toBe(70);
    expect(
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: selected.instanceId, model: "claude-opus-4-6" },
        config,
      ),
    ).toBe(5);
  });

  it("hides a failed read instead of displaying its stale windows as current", () => {
    const selected = provider({
      usageLimits: {
        checkedAt: "2026-10-22T18:00:00Z",
        windows: [window(20)],
        unavailable: { reason: "probeFailed" },
      },
    });
    expect(
      threadModelUsageRemainingPercent(
        environmentId,
        { instanceId: selected.instanceId, model: "gpt-6.1" },
        { providers: [selected], usageLimitSources: [] },
      ),
    ).toBeNull();
  });

  it("does not invent a percentage when limits are unavailable", () => {
    const selected = provider({ usageLimits: undefined });
    const selection = { instanceId: selected.instanceId, model: "custom-model" };
    expect(threadModelUsageRemainingPercent(environmentId, selection, null)).toBeNull();
    expect(
      threadModelUsageRemainingPercent(environmentId, selection, {
        providers: [selected],
        usageLimitSources: [],
      }),
    ).toBeNull();
  });
});
