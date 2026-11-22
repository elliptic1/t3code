import type { AppBarProps, AppBarMenuItem } from "../../components/ui/AppBar.types";
import type { VcsStatusResult } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Native header item factories are only read when options are applied, so the fake
// navigation snapshots the right items at each setOptions, as native-stack does.
const harness = vi.hoisted(() => ({
  setOptionsCalls: 0,
  appBar: null as AppBarProps | null,
  navigatedRoutes: [] as string[],
}));

vi.mock("@react-navigation/native", () => {
  const navigation = {
    canGoBack: () => true,
    dispatch: () => {},
    goBack: () => {},
    navigate: (route: string) => {
      harness.navigatedRoutes.push(route);
    },
    addListener: () => () => {},
    setOptions: () => {
      harness.setOptionsCalls += 1;
    },
  };
  return {
    StackActions: { replace: () => ({}) },
    useNavigation: () => navigation,
  };
});
vi.mock("../../native/useOpenPullRequest", () => ({ useOpenPullRequest: () => () => {} }));

vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../components/ui/AppBar", () => ({
  AppBar: (props: AppBarProps) => {
    harness.appBar = props;
    return null;
  },
}));
vi.mock("../layout/workspace/useAndroidWorkspaceNavigation", () => ({
  useWorkspaceBackNavigation: () => () => {},
}));
vi.mock("gt-react-native", () => ({
  msg: (text: string) => text,
  useGT: () => (text: string) => text,
  useMessages: () => (text: string) => text,
}));
vi.mock("react-native", () => ({ Alert: { alert: () => {} }, Linking: {}, Platform: {} }));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useWorkspacePaneState: () => ({ panes: { auxiliaryPaneVisible: false } }),
  useAdaptiveWorkspaceLayout: () => ({
    layout: { usesSplitView: false },
    panes: { primarySidebarVisible: false, auxiliaryPaneVisible: false },
    togglePrimarySidebar: () => {},
    toggleAuxiliaryPane: () => {},
  }),
}));
vi.mock("../layout/native-mail-search-toolbar", () => ({
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED: true,
  createNativeMailSearchToolbarItem: () => ({}),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeVariables: {} }),
}));

import { ThreadHeader } from "./ThreadHeader";

const projectScripts: never[] = [];

function status(
  files: ReadonlyArray<string>,
  overrides: Partial<VcsStatusResult> = {},
): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: false,
    isDefaultRef: true,
    refName: "master",
    hasWorkingTreeChanges: files.length > 0,
    workingTree: {
      files: files.map((path) => ({ path, insertions: 0, deletions: 0 })),
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  } as unknown as VcsStatusResult;
}

function Header(props: {
  readonly gitStatus: VcsStatusResult | null;
  readonly title?: string;
  readonly regeneratingTitle?: boolean;
  readonly onRegenerateTitle?: () => void;
}) {
  return (
    <ThreadHeader
      title={props.title ?? "Thread"}
      subtitle=""

      settled={false}
      regeneratingTitle={props.regeneratingTitle}
      onRegenerateTitle={props.onRegenerateTitle}
      gitControls={{
        environmentId: "environment-1",
        threadId: "thread-1",
        currentBranch: "master",
        gitStatus: props.gitStatus,
        gitOperationLabel: null,
        onPull: async () => {},
        onRunAction: async () => null,
        canOpenTerminal: true,
        canOperateTerminal: true,
        canOpenFiles: true,
        projectScripts,
        terminalSessions: [],
        onOpenTerminal: () => {},
        onOpenNewTerminal: () => {},
        onRunProjectScript: async () => {},
      }}
      hasThreadCwd

      inspectorMode={null}

      onOpenFilesInspector={() => {}}
    />
  );
}

const renderedThreadMenuItems = () => harness.appBar?.actions ?? [];
const renderedGitMenuItems = () =>
  (harness.appBar?.menus?.[0]?.items ?? []).filter(
    (item): item is Extract<AppBarMenuItem, { readonly onPress: () => void }> => "onPress" in item,
  );

function renderedGitStatusDescription(): unknown {
  return renderedGitMenuItems()[0]?.subtitle;
}

let root: Root | null = null;

function render(element: React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root ??= createRoot(document.createElement("div"));
  act(() => root!.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  harness.setOptionsCalls = 0;
  harness.appBar = null;
  harness.navigatedRoutes = [];
});

describe("ThreadHeader", () => {
  it("regenerates the title from the thread actions menu", async () => {
    const regenerate = vi.fn();
    render(<Header gitStatus={status([])} onRegenerateTitle={regenerate} />);

    const action = renderedThreadMenuItems().find(
      (item) => item.accessibilityLabel === "Regenerate title",
    );
    expect(action).toBeDefined();
    expect(
      renderedThreadMenuItems().some((item) => item.accessibilityLabel === "Rename thread"),
    ).toBe(false);

    await act(async () => action?.onPress?.());
    expect(regenerate).toHaveBeenCalledOnce();
  });

  it("shows progress and disables title regeneration while it is running", () => {
    render(<Header gitStatus={status([])} onRegenerateTitle={() => {}} regeneratingTitle />);
    expect(renderedThreadMenuItems()).toContainEqual(
      expect.objectContaining({ accessibilityLabel: "Regenerating title…", disabled: true }),
    );
  });

  it("re-applies native header items when Git status changes", () => {
    render(<Header gitStatus={status([])} />);
    expect(renderedGitStatusDescription()).toBe("Clean");

    render(<Header gitStatus={status(["audit.txt"])} />);
    expect(renderedGitStatusDescription()).toBe("1 changed");

    render(<Header gitStatus={status([])} />);
    expect(renderedGitStatusDescription()).toBe("Clean");
  });

  it("re-applies menu actions when the default ref changes behind the same label", async () => {
    const pushable = (isDefaultRef: boolean) =>
      status([], {
        isDefaultRef,
        aheadCount: 1,
        hasPrimaryRemote: true,
        pr: { state: "open", url: "https://example.com/pr/1" },
      } as Partial<VcsStatusResult>);
    render(<Header gitStatus={pushable(false)} />);
    expect(renderedGitMenuItems()[1]?.title).toBe("Push");

    render(<Header gitStatus={pushable(true)} />);
    expect(renderedGitMenuItems()[1]?.title).toBe("Push");
    await act(async () => renderedGitMenuItems()[1]?.onPress?.());
    expect(harness.navigatedRoutes).toEqual(["GitConfirm"]);
  });
});
