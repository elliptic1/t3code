import type { NavigationState } from "@react-navigation/native";
import { androidWorkspaceNavigationState } from "../../lib/android-workspace-navigation";
import type { WorkspaceTab } from "./workspace-tabs-state";

/** Usage and Settings join the two list tabs as top-level Android destinations. */
export type AndroidWorkspaceNavigationTab = WorkspaceTab | "usage" | "settings";

type SettingsTab = Extract<AndroidWorkspaceNavigationTab, "usage" | "settings">;

const WORKSPACE_ROUTES = new Set(["Home", "Thread", "PullRequest", "SettingsSheet"]);

/**
 * The Settings and Usage tabs reuse the settings navigator, reset over Home alone so stale
 * chat and PR history is dropped while nested settings pages keep an ordinary Back. Usage
 * opens above the Settings index, so Back from it lands on Settings.
 */
export function androidWorkspaceTabNavigationState(
  state: NavigationState,
  tab: AndroidWorkspaceNavigationTab,
) {
  const home = androidWorkspaceNavigationState(state);
  if (tab !== "settings" && tab !== "usage") return home;
  return {
    ...home,
    index: 1,
    routes: [
      ...home.routes,
      {
        name: "SettingsSheet",
        params: {
          screen: "SettingsContent",
          params:
            tab === "usage" ? { screen: "SettingsUsage", initial: false } : { screen: "Settings" },
        },
      },
    ],
  };
}

interface RouteLike {
  readonly name: string;
  readonly params?: object;
  readonly state?: { readonly index?: number; readonly routes: readonly RouteLike[] };
}

/** The focused screen inside a nested navigator, read from its params before it mounts. */
function focusedChild(route: RouteLike | undefined): RouteLike | undefined {
  if (!route) return undefined;
  if (route.state) return route.state.routes[route.state.index ?? route.state.routes.length - 1];
  const screen = (route.params as { screen?: unknown; params?: object } | undefined)?.screen;
  return typeof screen === "string"
    ? { name: screen, params: (route.params as { params?: object }).params }
    : undefined;
}

/**
 * Settings or Usage stays selected while the settings navigator is the topmost workspace
 * route; Usage while its pages are on top of that navigator.
 */
export function androidWorkspaceSettingsTab(state: NavigationState): SettingsTab | null {
  const top = state.routes
    .slice(0, state.index + 1)
    .findLast((route) => WORKSPACE_ROUTES.has(route.name));
  if (top?.name !== "SettingsSheet") return null;
  const page = focusedChild(focusedChild(top as RouteLike));
  return page?.name.startsWith("SettingsUsage") ? "usage" : "settings";
}

export function androidWorkspaceTabFromNavigationState(
  state: NavigationState,
  selected: AndroidWorkspaceNavigationTab,
): AndroidWorkspaceNavigationTab {
  const settingsTab = androidWorkspaceSettingsTab(state);
  if (settingsTab) return settingsTab;
  return selected === "settings" || selected === "usage" ? "threads" : selected;
}
