import { useIsFocused } from "@react-navigation/native";
import { useEffect, useId, useSyncExternalStore } from "react";

// Screens publish how far from the window bottom their bottom-anchored controls reach,
// so the floating voice button can sit above whatever currently fills that corner.
// Only focused screens count: a native stack keeps covered screens mounted.
const clearances = new Map<string, number>();
const listeners = new Set<() => void>();
let current: number | null = null;

function publish() {
  current = clearances.size ? Math.max(...clearances.values()) : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReserveVoiceFabClearance(bottom: number | null) {
  const key = useId();
  const reserved = useIsFocused() ? bottom : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this screen's bottom controls in the shared clearance store
  useEffect(() => {
    if (reserved === null) return;
    clearances.set(key, reserved);
    publish();
    return () => {
      clearances.delete(key);
      publish();
    };
  }, [key, reserved]);
}

export function useVoiceFabClearance() {
  return useSyncExternalStore(subscribe, () => current);
}
