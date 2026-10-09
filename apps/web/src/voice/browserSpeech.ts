import type { VoiceSpeech } from "@t3tools/client-runtime/voice-conversation/agent";

/** The part of the Web Speech API used here; TypeScript's DOM library omits it. */
interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  start: () => void;
  abort: () => void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const scope = globalThis as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is required. Allow it for this site and try again.",
  "service-not-allowed":
    "Speech recognition is not available here. Open T3 Code in Chrome, Edge, or Safari.",
  network:
    "Speech recognition is not available here. Open T3 Code in Chrome, Edge, or Safari, or use a realtime voice provider.",
  "audio-capture": "No microphone was found.",
  "language-not-supported": "Speech recognition does not support this browser's language.",
};

/**
 * The browser's own recognition and synthesis: no key, no model download. The
 * browser decides where audio is recognized, which may be its vendor's service.
 * Desktop's Chromium ships without a recognition service, so `network` is the
 * expected failure there.
 */
export function createBrowserSpeech(): VoiceSpeech {
  const Recognition = recognitionConstructor();
  if (!Recognition || !("speechSynthesis" in globalThis))
    throw new Error(RECOGNITION_ERRORS["service-not-allowed"]);
  return {
    listen: (signal) =>
      new Promise<string>((resolve, reject) => {
        if (signal.aborted) return resolve("");
        const recognition = new Recognition();
        recognition.lang = navigator.language;
        recognition.interimResults = false;
        let heard = "";
        let failure: Error | null = null;
        const abort = () => recognition.abort();
        signal.addEventListener("abort", abort, { once: true });
        recognition.addEventListener("result", (event) => {
          const { results } = event as Event & {
            results: ArrayLike<ArrayLike<{ transcript: string }>>;
          };
          heard = Array.from(results, (result) => result[0]?.transcript ?? "").join(" ");
        });
        recognition.addEventListener("error", (event) => {
          const { error } = event as Event & { error: string };
          // Silence and our own abort end the attempt quietly; the caller listens again.
          if (error === "no-speech" || error === "aborted") return;
          failure = new Error(RECOGNITION_ERRORS[error] ?? "Speech recognition failed.");
        });
        recognition.addEventListener("end", () => {
          signal.removeEventListener("abort", abort);
          if (failure) reject(failure);
          else resolve(heard);
        });
        recognition.start();
      }),
    speak: (text, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const utterance = new SpeechSynthesisUtterance(text);
        const done = () => {
          signal.removeEventListener("abort", cancel);
          resolve();
        };
        const cancel = () => {
          speechSynthesis.cancel();
          done();
        };
        signal.addEventListener("abort", cancel, { once: true });
        utterance.addEventListener("end", done);
        utterance.addEventListener("error", done);
        speechSynthesis.speak(utterance);
      }),
  };
}
