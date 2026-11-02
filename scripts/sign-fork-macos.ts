import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

export default async function sign(options: SignOptions): Promise<void> {
  const identity = process.env.T3CODE_FORK_SIGNING_IDENTITY?.trim();
  if (!identity || !/^[a-f0-9]{40}$/i.test(identity)) {
    throw new Error(
      "T3CODE_FORK_SIGNING_IDENTITY must pin a code-signing certificate fingerprint.",
    );
  }

  await signApplication({
    ...options,
    identity,
    // The fork uses a persistent local certificate, outside Apple's distribution certificate types.
    identityValidation: false,
    batchCodesignCalls: true,
    optionsForFile: (filePath, fileOptions) => ({
      ...options.optionsForFile?.(filePath, fileOptions),
      hardenedRuntime: false,
      timestamp: "none",
    }),
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
  });
}
