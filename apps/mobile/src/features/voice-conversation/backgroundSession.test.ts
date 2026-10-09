import { beforeEach, expect, it, vi } from "vite-plus/test";
import { startVoiceBackgroundSession } from "./backgroundSession";

const mocks = vi.hoisted(() => ({
  platform: { OS: "android" },
  start: vi.fn(),
  stop: vi.fn(),
  native: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("expo", () => ({ requireNativeModule: mocks.native }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.OS = "android";
  mocks.native.mockReturnValue({ start: mocks.start, stop: mocks.stop });
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
});

it("holds the Android service until the session releases it", async () => {
  const release = await startVoiceBackgroundSession();
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.stop).not.toHaveBeenCalled();
  await release();
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("cleans up a failed service start and reports the failure", async () => {
  mocks.start.mockRejectedValue(new Error("microphone service unavailable"));
  await expect(startVoiceBackgroundSession()).rejects.toThrow("microphone service unavailable");
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("does not load the Android module on iOS", async () => {
  mocks.platform.OS = "ios";
  const release = await startVoiceBackgroundSession();
  await release();
  expect(mocks.native).not.toHaveBeenCalled();
});
