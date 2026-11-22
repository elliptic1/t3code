import { msg } from "gt-react-native";
import { m as resolveCopy } from "../../i18n/messages";
import { useGT, useMessages } from "gt-react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

export function ThreadHeader(props: {
  readonly title: string;
  readonly onRename?: () => void;
  readonly onRegenerateTitle?: () => void;
  readonly regeneratingTitle?: boolean;
  readonly onOpenArtifacts?: () => void;
  readonly onOpenUsage?: () => void;
  readonly usageBadge?: string;
  readonly usageAccessibilityLabel?: string;
  readonly settled: boolean;
  readonly onToggleSettled?: () => void;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? gt("Close files") : gt("Open files"),
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  if (props.onOpenUsage) {
    actions.push({
      accessibilityLabel:
        props.usageAccessibilityLabel ?? resolveCopy(msg("Selected provider usage")),
      icon: "chart.bar.xaxis",
      badge: props.usageBadge,
      alwaysVisible: true,
      onPress: props.onOpenUsage,
    });
  }
  if (props.onRegenerateTitle) {
    actions.push({
      accessibilityLabel: props.regeneratingTitle
        ? resolveCopy(msg("Regenerating title…"))
        : resolveCopy(msg("Regenerate title")),
      icon: "arrow.clockwise",
      disabled: props.regeneratingTitle,
      overflowOnly: true,
      onPress: props.onRegenerateTitle,
    });
  }
  if (props.onOpenArtifacts) {
    actions.push({
      accessibilityLabel: resolveCopy(msg("Artifacts")),
      icon: "archivebox",
      overflowOnly: true,
      onPress: props.onOpenArtifacts,
    });
  }
  if (props.onToggleSettled) {
    actions.push({
      accessibilityLabel: props.settled
        ? resolveCopy(msg("Move out of settled"))
        : resolveCopy(msg("Settle thread")),
      icon: props.settled ? "arrow.uturn.backward" : "checkmark.circle",
      onPress: props.onToggleSettled,
    });
  }
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  return (
    <AppBar
      title={props.title}
      onTitlePress={props.onRename}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
