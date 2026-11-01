import type { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";

/** Restore the latest enabled phone pairing, including connections saved before watch sync existed. */
export function connectionForWatch(catalog: ConnectionCatalogDocument) {
  // Environments are newest last, but each environment's routes are preferred first.
  const environmentIds = [...new Set(catalog.targets.map((target) => target.environmentId))];
  // oxlint-disable-next-line unicorn/no-array-reverse -- Hermes does not support toReversed.
  const targets = environmentIds.reverse().flatMap((environmentId) =>
    catalog.targets.filter((target) => target.environmentId === environmentId),
  );
  for (const target of targets) {
    if (
      target._tag !== "BearerConnectionTarget" ||
      catalog.disabledEnvironmentIds.includes(target.environmentId)
    ) {
      continue;
    }
    const profile = catalog.profiles.find((entry) => entry.connectionId === target.connectionId);
    const credential = catalog.credentials.find(
      (entry) => entry.connectionId === target.connectionId,
    );
    if (
      profile?._tag === "BearerConnectionProfile" &&
      profile.authorization !== "t3-connect" &&
      credential?.credential._tag === "BearerConnectionCredential"
    ) {
      return {
        baseUrl: profile.httpBaseUrl,
        token: credential.credential.token,
        label: target.label,
      };
    }
  }
  return null;
}
