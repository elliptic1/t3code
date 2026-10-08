// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startPreviewMiniPlayerGesture } from "./previewMiniPlayerGesture";

const cleanups: Array<() => void> = [];

function pointer(type: string, values: Partial<PointerEvent> = {}) {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    pointerId: 1,
    buttons: 1,
    clientX: 100,
    clientY: 100,
    ...values,
  });
}

function start(captureAvailable = true) {
  const target = document.createElement("div");
  document.body.append(target);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag) => {
    const element = createElement(tag);
    let captured = false;
    element.setPointerCapture = () => {
      if (!captureAvailable) throw new Error("Capture unavailable");
      captured = true;
    };
    element.hasPointerCapture = () => captured;
    element.releasePointerCapture = () => {
      captured = false;
      element.dispatchEvent(pointer("lostpointercapture"));
    };
    return element;
  });
  const positions: Array<{ x: number; y: number }> = [];
  const finish = vi.fn();
  const cleanup = startPreviewMiniPlayerGesture({
    target,
    pointerId: 1,
    cursor: "grabbing",
    move: (event) => positions.push({ x: event.clientX, y: event.clientY }),
    finish,
  });
  cleanups.push(cleanup);
  const captureTarget = document.querySelector<HTMLElement>("[data-preview-gesture-shield]")!;
  return { target: captureTarget, handle: target, positions, finish, cleanup };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("floating preview pointer gesture", () => {
  it("keeps capture on the stationary shield when the moving handle loses capture", () => {
    const gesture = start();
    gesture.handle.dispatchEvent(pointer("lostpointercapture"));
    window.dispatchEvent(pointer("pointermove", { clientX: 250 }));
    expect(gesture.positions).toEqual([{ x: 250, y: 100 }]);
    expect(gesture.finish).not.toHaveBeenCalled();
    window.dispatchEvent(pointer("pointerup", { buttons: 0, clientX: 260 }));
    expect(gesture.positions.at(-1)).toEqual({ x: 260, y: 100 });
    expect(gesture.finish).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    "tracks shield movement and final release, capture available: %s",
    (captureAvailable) => {
      const gesture = start(captureAvailable);
      const shield = document.querySelector("[data-preview-gesture-shield]")!;
      shield.dispatchEvent(pointer("pointermove", { clientX: 200, clientY: 250 }));
      shield.dispatchEvent(pointer("pointerup", { buttons: 0, clientX: 220, clientY: 270 }));
      expect(gesture.positions).toEqual([
        { x: 200, y: 250 },
        { x: 220, y: 270 },
      ]);
      expect(document.querySelector("[data-preview-gesture-shield]")).toBeNull();
      expect(gesture.target.hasPointerCapture(1)).toBe(false);
      expect(gesture.finish).toHaveBeenCalledOnce();
      window.dispatchEvent(pointer("pointermove"));
      expect(gesture.positions).toHaveLength(2);
    },
  );

  it("ignores other pointers moving, releasing, or cancelling", () => {
    const gesture = start();
    for (const type of ["pointermove", "pointerup", "pointercancel"]) {
      window.dispatchEvent(pointer(type, { pointerId: 2 }));
    }
    expect(gesture.positions).toEqual([]);
    expect(gesture.finish).not.toHaveBeenCalled();
    expect(gesture.target.hasPointerCapture(1)).toBe(true);
  });

  it.each([
    "pointercancel",
    "lostpointercapture",
    "blur",
    "Escape",
    "hidden",
    "missed release",
    "unmount",
  ])("cleans up on %s and ignores late events", (interruption) => {
    const gesture = start();
    window.dispatchEvent(pointer("pointermove", { clientX: 200 }));
    switch (interruption) {
      case "pointercancel":
        window.dispatchEvent(pointer("pointercancel"));
        break;
      case "lostpointercapture":
        gesture.target.dispatchEvent(pointer("lostpointercapture"));
        break;
      case "blur":
        window.dispatchEvent(new Event("blur"));
        break;
      case "Escape":
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        break;
      case "hidden":
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
        break;
      case "missed release":
        window.dispatchEvent(pointer("pointermove", { buttons: 0 }));
        break;
      case "unmount":
        gesture.cleanup();
        break;
    }
    window.dispatchEvent(pointer("pointermove"));
    window.dispatchEvent(pointer("pointerup", { buttons: 0 }));
    gesture.cleanup();
    expect(gesture.positions).toEqual([{ x: 200, y: 100 }]);
    expect(gesture.finish).toHaveBeenCalledOnce();
    expect(gesture.target.hasPointerCapture(1)).toBe(false);
    expect(document.querySelector("[data-preview-gesture-shield]")).toBeNull();
  });
});
