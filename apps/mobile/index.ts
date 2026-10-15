import { registerRootComponent } from "expo";
import "react-native-gesture-handler";
import { AppRegistry, LogBox } from "react-native";
import { featureFlags } from "react-native-screens";

import App from "./src/App";

// Required for react-native-screens' iOS FormSheet sizing fix when a nested
// native stack is rendered inside a non-fitToContents formSheet.
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
  const { keepPhoneConnectionsAlive } = await import("./src/rpc/watch-companion");
  await keepPhoneConnectionsAlive();
});
