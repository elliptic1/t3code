import type { DesktopBridge } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
import { toastManager } from "../components/ui/toast";
import { useDesktopDictation } from "./useDesktopDictation";

const start = vi.fn(async () => true);
const stop = vi.fn(async () => true);
const focus = vi.fn(() => true);

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

function setup() {
  const previous = window.desktopBridge;
  vi.clearAllMocks();
  start.mockResolvedValue(true);
  stop.mockResolvedValue(true);
  window.desktopBridge = { startDictation: start, stopDictation: stop } as unknown as DesktopBridge;
  return {
    [Symbol.dispose]() {
      if (previous === undefined) delete window.desktopBridge;
      else window.desktopBridge = previous;
    },
  };
}

function click(screen: Awaited<ReturnType<typeof render>>) {
  return act(async () => screen.container.querySelector("button")!.click());
}

it("starts on the first click, stops on the second, and can start again", async () => {
  using _setup = setup();
  await using screen = await render(<Harness />);
  await click(screen);
  expect(start).toHaveBeenCalledTimes(1);
  expect(screen.container.textContent).toBe("Stop");
  await click(screen);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.container.textContent).toBe("Start");
  await click(screen);
  expect(start).toHaveBeenCalledTimes(2);
});

it("lets the next click start after Escape stops dictation", async () => {
  using _setup = setup();
  await using screen = await render(<Harness />);
  await click(screen);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await click(screen);
  expect(start).toHaveBeenCalledTimes(2);
  expect(stop).not.toHaveBeenCalled();
});

it("keeps the stop action available if native stopping fails", async () => {
  using _setup = setup();
  await using screen = await render(<Harness />);
  await click(screen);
  stop.mockResolvedValueOnce(false);
  await click(screen);
  expect(screen.container.textContent).toBe("Stop");
  expect(toastManager.add).toHaveBeenCalledWith({
    type: "error",
    title: "Could not stop dictation",
  });
  await click(screen);
  expect(stop).toHaveBeenCalledTimes(2);
  expect(screen.container.textContent).toBe("Start");
});

it("does not mark a failed start as active", async () => {
  using _setup = setup();
  await using screen = await render(<Harness />);
  start.mockRejectedValueOnce(new Error("Native failure"));
  await click(screen);
  expect(screen.container.textContent).toBe("Start");
  await click(screen);
  expect(start).toHaveBeenCalledTimes(2);
});

it("stops a native start that finishes after Escape", async () => {
  using _setup = setup();
  await using screen = await render(<Harness />);
  let finishStart!: (value: boolean) => void;
  start.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishStart = resolve;
      }),
  );
  await click(screen);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    finishStart(true);
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.container.textContent).toBe("Start");
});
