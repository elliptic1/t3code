// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useSettings", () => ({ useEnvironmentIdentificationMode: () => "none" }));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));
vi.mock("../../shortcutModifierState", () => ({
  useShortcutModifierState: () => ({ metaKey: false, ctrlKey: false }),
}));
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

let root: Root;
let container: HTMLDivElement;
const submit = vi.fn();
const sendAction = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  submit.mockClear();
  sendAction.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ComposerPrimaryActions
        compact
        canOperateThread
        pendingAction={null}
        isRunning
        canInterrupt
        followUpBehavior="queue"
        canSteer
        canStartParallelAgent
        onSendAction={sendAction}
        showPlanFollowUpPrompt={false}
        promptHasText
        isSendBusy={false}
        sendDisabledReason={null}
        isConnecting={false}
        isEnvironmentUnavailable={false}
        isPreparingWorktree={false}
        hasSendableContent
        onSubmitMessage={submit}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function button() {
  return container.querySelector<HTMLButtonElement>('[aria-label="Queue message"]')!;
}
function pointer(type: string, x = 0) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
}

it("keeps a short press as queue, and suppresses sending when a hold opens the choices", async () => {
  const trigger = button();
  trigger.setPointerCapture = vi.fn();
  await act(async () => {
    trigger.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(100);
    trigger.dispatchEvent(pointer("pointerup"));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => {
    trigger.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(600);
  });
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () => {
    trigger.dispatchEvent(pointer("pointerup"));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  expect(submit).toHaveBeenCalledTimes(1);
  const parallel = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes("Start parallel agent"),
  )!;
  await act(async () => parallel.click());
  expect(sendAction).toHaveBeenCalledWith("parallel");
  expect(submit).toHaveBeenCalledTimes(1);
});

it("cancels a hold and sending when the pointer moves away", async () => {
  const trigger = button();
  trigger.setPointerCapture = vi.fn();
  await act(async () => {
    trigger.dispatchEvent(pointer("pointerdown"));
    trigger.dispatchEvent(pointer("pointermove", 30));
    vi.advanceTimersByTime(600);
    trigger.dispatchEvent(pointer("pointerup", 30));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it("opens the same choices with the keyboard and sends a steer", async () => {
  await act(async () => {
    button().focus();
    button().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  const steer = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Steer now",
  )!;
  expect(steer).toBeDefined();
  await act(async () => steer.click());
  expect(sendAction).toHaveBeenCalledWith("steer");
  expect(submit).not.toHaveBeenCalled();
});
