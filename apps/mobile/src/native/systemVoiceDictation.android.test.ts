import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  isAvailable: vi.fn(() => true),
  recognize: vi.fn<(locale: string) => Promise<string | null>>(),
  cancel: vi.fn(async () => {}),
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => native }));
import { getSystemVoiceDictation } from "./systemVoiceDictation.android";

beforeEach(() => {
  vi.clearAllMocks();
  native.isAvailable.mockReturnValue(true);
});

describe("Android system dictation", () => {
  it("hides the action when no recognizer is installed", () => {
    native.isAvailable.mockReturnValue(false);
    expect(getSystemVoiceDictation()).toBeNull();
  });
  it("passes the device locale to the native dialog and returns its transcript", async () => {
    native.recognize.mockResolvedValue("some speech");
    const dictation = getSystemVoiceDictation()!;
    expect(await dictation.recognize(new AbortController().signal)).toBe("some speech");
    expect(native.recognize).toHaveBeenCalledWith(dictation.locale);
  });
  it("closes the native dialog on abort and ignores a late transcript", async () => {
    let resolve!: (text: string) => void;
    native.recognize.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const controller = new AbortController();
    const result = getSystemVoiceDictation()!.recognize(controller.signal);
    controller.abort();
    expect(native.cancel).toHaveBeenCalledOnce();
    resolve("late result");
    expect(await result).toBeNull();
  });
  it("does not open a dialog for an already cancelled draft", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await getSystemVoiceDictation()!.recognize(controller.signal)).toBeNull();
    expect(native.recognize).not.toHaveBeenCalled();
  });
  it("propagates recognition failures instead of reporting cancellation", async () => {
    const error = new Error("Speech recognition failed (result code 4).");
    native.recognize.mockRejectedValue(error);
    await expect(getSystemVoiceDictation()!.recognize(new AbortController().signal)).rejects.toBe(
      error,
    );
  });
  it("returns null when the native dialog is cancelled", async () => {
    native.recognize.mockResolvedValue(null);
    expect(await getSystemVoiceDictation()!.recognize(new AbortController().signal)).toBeNull();
  });
});
