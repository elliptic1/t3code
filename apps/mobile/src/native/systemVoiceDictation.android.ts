import { requireOptionalNativeModule } from "expo";
import type { SystemVoiceDictation } from "@t3tools/client-runtime/voice-input";

const native = requireOptionalNativeModule<{
  isAvailable: () => boolean;
  recognize: (locale: string) => Promise<string | null>;
  cancel: () => Promise<void>;
}>("T3Dictation");

export function getSystemVoiceDictation(): SystemVoiceDictation | null {
  if (!native?.isAvailable()) return null;
  const module = native;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return {
    locale,
    recognize: async (signal) => {
      if (signal.aborted) return null;
      const cancel = () => {
        void module.cancel().catch(() => {});
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const transcript = await module.recognize(locale);
        return signal.aborted ? null : transcript;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}
