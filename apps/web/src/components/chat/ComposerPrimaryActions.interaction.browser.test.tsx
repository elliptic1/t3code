import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../../test/render";

vi.mock("~/hooks/useSettings", () => ({ useEnvironmentIdentificationMode: () => "none" }));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));
vi.mock("../../shortcutModifierState", () => ({
  useShortcutModifierState: () => ({ metaKey: false, ctrlKey: false }),
}));
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

const submit = vi.fn();
const sendAction = vi.fn();

function setup() {
  submit.mockClear();
  sendAction.mockClear();
}

async function view() {
  return render(
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
}

function button(screen: Awaited<ReturnType<typeof view>>) {
  return screen.container.querySelector<HTMLButtonElement>('[aria-label="Queue message"]')!;
}
function pointer(type: string, x = 0) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
}

it("keeps a short press as queue, and suppresses sending when a hold opens the choices", async () => {
  setup();
  using _timers = fakeTimers();
  await using screen = await view();
  const trigger = button(screen);
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
  await expect.element(page.getByRole("menu")).toBeInTheDocument();
  await act(async () => {
    trigger.dispatchEvent(pointer("pointerup"));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  expect(submit).toHaveBeenCalledTimes(1);
  await page.getByRole("menuitem", { name: /Start parallel agent/ }).click();
  expect(sendAction).toHaveBeenCalledWith("parallel");
  expect(submit).toHaveBeenCalledTimes(1);
});

it("cancels a hold and sending when the pointer moves away", async () => {
  setup();
  using _timers = fakeTimers();
  await using screen = await view();
  const trigger = button(screen);
  trigger.setPointerCapture = vi.fn();
  await act(async () => {
    trigger.dispatchEvent(pointer("pointerdown"));
    trigger.dispatchEvent(pointer("pointermove", 30));
    vi.advanceTimersByTime(600);
    trigger.dispatchEvent(pointer("pointerup", 30));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});

it("opens the same choices with the keyboard and sends a steer", async () => {
  setup();
  await using screen = await view();
  await act(async () => {
    button(screen).focus();
    button(screen).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  const steer = page.getByRole("menuitem", { name: "Steer now" });
  await expect.element(steer).toBeInTheDocument();
  await steer.click();
  expect(sendAction).toHaveBeenCalledWith("steer");
  expect(submit).not.toHaveBeenCalled();
});
