import { describe, expect, it } from "vite-plus/test";
import { splitAndroidHeaderActions } from "./headerMenu.android";

describe("Android header action visibility", () => {
  it("keeps requested controls together on a narrow header and retains overflow-only actions", () => {
    const actions = [
      { id: "return" },
      { id: "files", alwaysVisible: true },
      { id: "usage", alwaysVisible: true },
      { id: "rename", overflowOnly: true },
      { id: "git" },
    ];
    const { visibleActions, overflowActions } = splitAndroidHeaderActions(actions, false);
    expect(visibleActions.map((action) => action.id)).toEqual(["files", "usage"]);
    expect(overflowActions.map((action) => action.id)).toEqual(["return", "rename", "git"]);
  });
  it("fills the remaining wide header slot without reordering actions", () => {
    const actions = [
      { id: "return" },
      { id: "files", alwaysVisible: true },
      { id: "usage", alwaysVisible: true },
      { id: "rename", overflowOnly: true },
    ];
    expect(
      splitAndroidHeaderActions(actions, true).visibleActions.map((action) => action.id),
    ).toEqual(["return", "files", "usage"]);
  });
  it("preserves the normal overflow behavior on other screens", () => {
    const actions = [
      { id: "one", overflowOnly: false },
      { id: "two", overflowOnly: false },
      { id: "three", overflowOnly: false },
    ];
    expect(splitAndroidHeaderActions(actions, false).visibleActions).toEqual([actions[0]]);
    expect(splitAndroidHeaderActions(actions, true).overflowActions).toEqual([]);
    expect(splitAndroidHeaderActions(actions.slice(0, 2), false).visibleActions).toEqual(
      actions.slice(0, 2),
    );
  });
});
