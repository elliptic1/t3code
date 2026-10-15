import { useCallback, useEffect, useRef, useState } from "react";

import { toastManager } from "../components/ui/toast";

/** Toggles native macOS Dictation while retaining focus in the composer. */
export function useDesktopDictation(focusEditor: () => boolean) {
  const [isActive, setIsActive] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  const cancelled = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelled.current = true;
      active.current = false;
      setIsActive(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      mounted.current = false;
      cancelled.current = true;
      window.removeEventListener("keydown", onKeyDown, true);
      if (active.current) {
        active.current = false;
        void window.desktopBridge?.stopDictation?.().catch(console.error);
      }
    };
  }, []);

  const toggle = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (pending.current || !bridge?.startDictation || !focusEditor()) return;
    const stopping = active.current;
    const action = stopping ? bridge.stopDictation : bridge.startDictation;
    if (!action) return;
    pending.current = true;
    cancelled.current = false;
    setIsPending(true);
    try {
      if (!(await action())) throw new Error("System Dictation action was unavailable.");
      // Escape or a thread change can happen while the native start is in flight.
      if (!stopping && cancelled.current) {
        await bridge.stopDictation?.();
        return;
      }
      active.current = !stopping && bridge.stopDictation !== undefined;
      if (mounted.current) setIsActive(active.current);
    } catch {
      if (mounted.current) {
        toastManager.add({
          type: "error",
          title: `Could not ${stopping ? "stop" : "start"} dictation`,
        });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setIsPending(false);
    }
  }, [focusEditor]);

  return { isActive, isPending, toggle };
}
