// @effect-diagnostics nodeBuiltinImport:off - exercises the installed dependency patch with real React effects.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

type Input = { itemKey: string; data: object; extraData?: object; horizontal?: boolean };

// Re-render the measuring row when its coordinator publishes a layout epoch,
// like the nested Fabric commits in the model/prompt picker crash.
function createHarness(bundle: string) {
  const source = NodeFS.readFileSync(
    NodePath.resolve(import.meta.dirname, "../../node_modules/@legendapp/list", bundle),
    "utf8",
  );
  const hookSource = source.slice(
    source.indexOf("function useContainerMeasurement("),
    source.indexOf("function getContainerPositionStyle("),
  );
  let epoch = 0;
  const listeners = new Set<() => void>();
  const ctx = { containerLayoutTriggers: new Map<number, () => void>() };
  const schedule = vi.fn(() => {
    epoch += 1;
    for (const listener of listeners) listener();
  });
  const measure = vi.fn();
  const useMeasurement = NodeVM.runInNewContext(`${hookSource}\nuseContainerMeasurement`, {
    ...React,
    React2: React,
    IsNewArchitecture: true,
    Platform: { OS: "android" },
    scheduleContainerLayout: schedule,
    cancelWebShrinkMeasurement: () => {},
    processContainerLayout: measure,
    useOnLayoutSync: ({ onLayoutChange }: { onLayoutChange: (layout: object) => void }) => ({
      onLayout: onLayoutChange,
    }),
  }) as (input: Input & { containerId: number; ctx: object; ref: object }) => {
    onLayout: (layout: object) => void;
    triggerLayout: () => void;
  };
  let api: ReturnType<typeof useMeasurement>;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function Row(input: Input) {
    React.useSyncExternalStore(
      subscribe,
      () => epoch,
      () => epoch,
    );
    const ref = React.useRef(null);
    const measurement = useMeasurement({ ...input, containerId: 0, ctx, ref });
    React.useLayoutEffect(() => {
      api = measurement;
    }, [measurement]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  return {
    render(input: Input) {
      act(() => root.render(<Row {...input} />));
    },
    schedule,
    measure,
    triggerLayout() {
      act(() => api.triggerLayout());
    },
    resize() {
      act(() => api.onLayout({ width: 400, height: 120 }));
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe.each(["react-native.js", "react-native.mjs"])("native row measurement (%s)", (bundle) => {
  it("settles after measurement updates and remeasures changed or recycled content", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    using list = createHarness(bundle);
    const input = { itemKey: "model", data: { label: "Model" } };
    list.render(input);
    expect(list.schedule).toHaveBeenCalledTimes(1);
    list.render(input);
    expect(list.schedule).toHaveBeenCalledTimes(1);
    list.render({ ...input, data: { label: "Updated model" } });
    expect(list.schedule).toHaveBeenCalledTimes(2);
    list.render({ ...input, itemKey: "prompt" });
    expect(list.schedule).toHaveBeenCalledTimes(3);
    list.render({ ...input, extraData: { expanded: true } });
    expect(list.schedule).toHaveBeenCalledTimes(4);
    list.triggerLayout();
    expect(list.schedule).toHaveBeenCalledTimes(5);
    list.resize();
    expect(list.measure).toHaveBeenCalledTimes(1);
  });
});
