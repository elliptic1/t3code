/** Keeps gestures in the host document when crossing Electron webviews or iframes. */
export function startPreviewMiniPlayerGesture({
  target,
  pointerId,
  cursor,
  move,
  finish,
}: {
  target: HTMLElement;
  pointerId: number;
  cursor: string;
  move: (event: PointerEvent) => void;
  finish: () => void;
}) {
  const document = target.ownerDocument;
  const window = document.defaultView!;
  const shield = document.createElement("div");
  shield.dataset.previewGestureShield = "";
  // Above all hosted webviews (48), below dialogs (50). No page content is hidden.
  Object.assign(shield.style, {
    position: "fixed",
    inset: "0",
    zIndex: "49",
    cursor,
    touchAction: "none",
    userSelect: "none",
  });
  document.body.append(shield);
  let active = true;
  function cleanup() {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", cleanup);
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    shield.removeEventListener("lostpointercapture", onCancel);
    if (shield.hasPointerCapture(pointerId)) shield.releasePointerCapture(pointerId);
    shield.remove();
    finish();
  }
  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    if (event.buttons === 0) {
      cleanup();
      return;
    }
    event.preventDefault();
    move(event);
  }
  function onUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    move(event);
    cleanup();
  }
  function onCancel(event: PointerEvent) {
    if (event.pointerId === pointerId) cleanup();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") cleanup();
  }
  function onVisibilityChange() {
    if (document.hidden) cleanup();
  }
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", cleanup);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibilityChange);
  shield.addEventListener("lostpointercapture", onCancel);
  try {
    // Capture on the stationary shield: moving the header over a native guest
    // can make Chromium drop capture on that moving element.
    shield.setPointerCapture(pointerId);
  } catch {
    // The shield and window listeners also work when capture is unavailable.
  }
  return cleanup;
}
