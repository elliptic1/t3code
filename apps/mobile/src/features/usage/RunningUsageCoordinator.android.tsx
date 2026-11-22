import { useEffect } from "react";
import { retainRunningUsageMonitor } from "./runningUsageMonitor";

export function RunningUsageCoordinator() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retains the native subscription monitor for this client session
  useEffect(() => retainRunningUsageMonitor(), []);
  return null;
}
