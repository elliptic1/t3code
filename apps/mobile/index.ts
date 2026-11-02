// Must stay first: the render counter and behavior probe wrap the DevTools hook before any React commit.
import "./src/features/development/render-counter-entry";
import "./src/features/development/behavior-probe-entry";
// Next, so errors thrown while the rest of the app loads are recorded too.
import "./src/features/observability/observe";
import { registerRootComponent } from "expo";
import "react-native-gesture-handler";
import { AppRegistry, LogBox } from "react-native";
import { featureFlags } from "react-native-screens";

import App from "./src/App";

// Enables iOS FormSheet sizing for nested native stacks in non-fitToContents sheets.
featureFlags.experiment.synchronousScreenUpdatesEnabled = true;

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  LogBox.ignoreAllLogs();
}

registerRootComponent(App);

// Wear Data Layer requests can start the phone runtime while the app is backgrounded.
AppRegistry.registerHeadlessTask("T3WatchRequest", () => async (input) => {
  const { handleWatchRequest } = await import("./src/rpc/watch-companion");
  await handleWatchRequest(input);
});

AppRegistry.registerHeadlessTask("T3ConnectionPresence", () => async () => {
  const [{ keepPhoneConnectionsAlive }, { retainRunningUsageMonitor }] = await Promise.all([
    import("./src/rpc/watch-companion"),
    import("./src/features/usage/runningUsageMonitor"),
  ]);
  const release = retainRunningUsageMonitor();
  try {
    await keepPhoneConnectionsAlive();
  } finally {
    release();
  }
});

AppRegistry.registerHeadlessTask("T3RunningUsage", () => async () => {
  const { keepRunningUsageConnected } = await import("./src/features/usage/runningUsageMonitor");
  await keepRunningUsageConnected();
});

AppRegistry.registerHeadlessTask("T3ThreadInputResponse", () => async (input) => {
  const { handleThreadInputResponse } =
    await import("./src/features/agent-awareness/threadInputResponse");
  await handleThreadInputResponse(input);
});
