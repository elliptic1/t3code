import type { EnvironmentId, ModelSelection, ServerConfig } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  limitsNotice,
} from "@t3tools/shared/usageLimits";

/** The selected login's tightest allowance, rather than every login's combined balance. */
export function threadModelUsageSnapshot(
  environmentId: EnvironmentId,
  selection: ModelSelection,
  config: Pick<ServerConfig, "providers" | "usageLimitSources"> | null | undefined,
) {
  const provider = config?.providers.find((entry) => entry.instanceId === selection.instanceId);
  if (!provider) return null;
  const hasNativeLimits = provider.usageLimits && limitsNotice(provider.usageLimits) === null;
  const sources = hasNativeLimits
    ? []
    : (config?.usageLimitSources ?? []).map((source) => ({
        ...source,
        accounts: source.accounts.filter(
          (account) =>
            account.driver === provider.driver &&
            (!provider.auth.email ||
              account.email?.toLowerCase() === provider.auth.email.toLowerCase()) &&
            (!provider.auth.workspaceId || account.workspaceId === provider.auth.workspaceId),
        ),
      }));
  const model = selection.model.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const accounts = collectLimitAccounts(
    new Map([
      [
        environmentId,
        {
          entry: { target: { label: "Thread" } },
          serverConfig: { providers: [provider], usageLimitSources: sources },
        },
      ],
    ]),
  ).map((account) => ({
    ...account,
    limits: {
      ...account.limits,
      windows: account.limits.windows.filter((window) => {
        if (provider.driver === "claudeAgent" && window.id.startsWith("seven_day_")) {
          return model.includes(window.id.slice("seven_day_".length));
        }
        if (provider.driver === "antigravity") {
          if (window.id.startsWith("gemini-")) return model.includes("gemini");
          if (window.id.startsWith("3p-")) return /claude|gpt/.test(model);
          if (window.id.startsWith("claude-")) return model.includes("claude");
          if (window.id.startsWith("gpt-")) return model.includes("gpt");
        }
        return true;
      }),
    },
  }));
  const pool = collectLimitPools(accounts, Date.parse(provider.checkedAt)).find(
    (entry) => entry.driver === provider.driver,
  );
  const windows = pool ? displayLimitWindows(pool) : [];
  if (!pool || windows.length === 0) return null;
  return {
    identity: JSON.stringify([
      provider.driver,
      provider.auth.workspaceId,
      ...pool.accounts
        .map((account) =>
          JSON.stringify([
            account.email?.toLowerCase() ?? account.limits.credentialFingerprint ?? account.key,
            account.environments.length === 0 ? account.key : null,
          ]),
        )
        .sort(),
    ]),
    checkedAt: Math.min(...pool.accounts.map((account) => Date.parse(account.limits.checkedAt))),
    windows,
  };
}

export function threadModelUsageRemainingPercent(
  environmentId: EnvironmentId,
  selection: ModelSelection,
  config: Pick<ServerConfig, "providers" | "usageLimitSources"> | null | undefined,
): number | null {
  const snapshot = threadModelUsageSnapshot(environmentId, selection, config);
  return snapshot ? Math.min(...snapshot.windows.map((window) => window.remainingPercent)) : null;
}
