// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { DesktopBridge } from "@t3tools/contracts";

vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
import { toastManager } from "../components/ui/toast";
import { useDesktopDictation } from "./useDesktopDictation";

const start = vi.fn(async () => true);
const stop = vi.fn(async () => true);
const focus = vi.fn(() => true);
let root: Root;
let container: HTMLDivElement;

function Harness() {
  const dictation = useDesktopDictation(focus);
  return (
    <button
      disabled={dictation.isPending}
      aria-pressed={dictation.isActive}
      onClick={() => {
        void dictation.toggle();
      }}
    >
      {dictation.isActive ? "Stop" : "Start"}
    </button>
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  start.mockResolvedValue(true);
  stop.mockResolvedValue(true);
  window.desktopBridge = { startDictation: start, stopDictation: stop } as unknown as DesktopBridge;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete window.desktopBridge;
  vi.unstubAllGlobals();
});

async function click() {
  await act(async () => {
    container.querySelector("button")!.click();
  });
}

it("starts on the first click, stops on the second, and can start again", async () => {
  await click();
  expect(start).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("Stop");
  await click();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("Start");
  await click();
  expect(start).toHaveBeenCalledTimes(2);
});

it("lets the next click start after Escape stops dictation", async () => {
  await click();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await click();
  expect(start).toHaveBeenCalledTimes(2);
  expect(stop).not.toHaveBeenCalled();
});

it("keeps the stop action available if native stopping fails", async () => {
  await click();
  stop.mockResolvedValueOnce(false);
  await click();
  expect(container.textContent).toBe("Stop");
  expect(toastManager.add).toHaveBeenCalledWith({
    type: "error",
    title: "Could not stop dictation",
  });
  await click();
  expect(stop).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe("Start");
});

it("does not mark a failed start as active", async () => {
  start.mockRejectedValueOnce(new Error("Native failure"));
  await click();
  expect(container.textContent).toBe("Start");
  await click();
  expect(start).toHaveBeenCalledTimes(2);
});

it("stops a native start that finishes after Escape", async () => {
  let finishStart!: (value: boolean) => void;
  start.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishStart = resolve;
      }),
  );
  await click();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    finishStart(true);
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("Start");
});
