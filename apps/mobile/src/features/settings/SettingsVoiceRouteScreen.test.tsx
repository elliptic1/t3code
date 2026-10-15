// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  settings: undefined as typeof DEFAULT_SERVER_SETTINGS | undefined,
  update: vi.fn(),
}));

vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Switch: (props: {
    value: boolean;
    disabled: boolean;
    accessibilityLabel: string;
    onValueChange: (value: boolean) => void;
  }) => (
    <button
      role="switch"
      aria-label={props.accessibilityLabel}
      aria-checked={props.value}
      disabled={props.disabled}
      onClick={() => props.onValueChange(!props.value)}
    />
  ),
  TextInput: () => null,
}));
vi.mock("../../components/AppText", () => ({
  AppText: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("./components/SettingsScreen", () => ({
  SettingsScreen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../voice-conversation/VoiceButton", () => ({ VoiceButton: () => null }));
vi.mock("../voice-conversation/actions", async () => {
  const { voiceResult } = await import("@t3tools/client-runtime/voice-conversation/actions");
  return { voiceResult };
});
vi.mock("../../state/server", () => ({ serverEnvironment: { updateSettings: {} } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.update }));
vi.mock("./settings-environment-filter", () => ({
  useSettingsEnvironmentFilter: () => ({
    availableTargets: [
      {
        environmentId: "mac",
        label: "Mac",
        serverConfig: { settings: harness.settings },
      },
    ],
  }),
}));

import { SettingsVoiceRouteScreen } from "./SettingsVoiceRouteScreen";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  harness.settings = DEFAULT_SERVER_SETTINGS;
  harness.update.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;

it("persists enabling and disabling across leaving and reopening Settings", async () => {
  harness.update.mockImplementation(async ({ input }) => {
    harness.settings = { ...harness.settings!, ...input.patch };
    return AsyncResult.success(harness.settings);
  });
  for (const enabled of [true, false]) {
    await act(async () => root.render(<SettingsVoiceRouteScreen />));
    await act(async () => toggle().click());
    expect(harness.settings?.voiceConnection.enabled).toBe(enabled);
    await act(async () => root.render(null));
    await act(async () => root.render(<SettingsVoiceRouteScreen />));
    expect(toggle().getAttribute("aria-checked")).toBe(String(enabled));
  }
});

it("restores the saved toggle and shows the error when saving fails", async () => {
  harness.update.mockRejectedValue(new Error("Connection lost"));
  await act(async () => root.render(<SettingsVoiceRouteScreen />));
  await act(async () => toggle().click());
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).toContain("Connection lost");
});
