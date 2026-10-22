import { useEffect } from "react";
import { retainRunningUsageMonitor } from "./runningUsageMonitor";

export function RunningUsageCoordinator() {
  useEffect(() => retainRunningUsageMonitor(), []);
  return null;
}
