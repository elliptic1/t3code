import type { DesktopUpdateState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { isElectron } from "../env";
import { ensureLocalApi } from "../localApi";
import { readProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { createVoiceActions } from "../voice/actions";
import { stackedThreadToast, toastManager } from "./ui/toast";

const sourceDir = import.meta.env.T3CODE_SOURCE_DIR.replace(/\/+$/u, "");

export const SOURCE_UPDATE_TOOLTIP = {
  title: "Update from source",
  detail:
    "Pull the latest commits into the checkout this app was built from, then rebuild, restart it, and push the result to your fork.",
} as const;

const updatePrompt = `Update this app from source.

Run \`${sourceDir}/scripts/fork-update.sh\`. It merges the latest commits from the checked-out branch's remote, and from upstream's main (the \`upstream\` or \`origin\` remote), into that branch in an update worktree beside ${sourceDir}. Then it typechecks, fast-forwards the branch in ${sourceDir}, rebuilds and reinstalls the app, and pushes the branch to its remote. The build takes several minutes, so run it where a tool timeout won't kill it.

- Exit 0: report what was merged (\`git log --oneline --first-parent\` of the new merges) in a few lines. The app restarts about 10 seconds after the build finishes, so reply right away.
- Exit 2: resolve the merge conflicts or typecheck errors it lists in the update worktree, commit, and run the script again. An upstream migration whose id the fork already uses gets the next free id, plus entries in \`reconcileUpstreamMigrationIds\` (\`apps/server/src/persistence/Migrations.ts\`) and \`reconcileV2PreviewMigration.test.ts\`.
- Exit 4: uncommitted changes in ${sourceDir} block the fast-forward. Tell me which files, and don't stash or discard them.
- Anything else: tell me which step failed and why.

If the output says PUSH FAILED, tell me. The script does the push itself, so don't push or force-push by hand. Don't work in ${sourceDir} itself, since a dev server or other agents may be using it.`;

/**
 * Builds made by scripts/fork-build.sh have no update feed. They know their source checkout
 * instead, so the update button hands the pull, build and install to an agent thread there.
 */
export function useSourceUpdate(state: DesktopUpdateState | null) {
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const available =
    isElectron && sourceDir !== "" && environmentId !== null && state?.status === "disabled";

  const start = async (): Promise<void> => {
    if (!available) return;
    try {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Update from source?\n\nAn agent thread pulls the latest commits into ${sourceDir}, rebuilds the app, and restarts it to install.`,
      );
      if (!confirmed) return;
      const run = createVoiceActions(environmentId, async (threadId) => {
        await navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
      });
      const existing = readProjects().find(
        (project) =>
          project.environmentId === environmentId &&
          project.workspaceRoot.replace(/\/+$/u, "") === sourceDir,
      );
      const projectId =
        existing?.id ??
        (
          (await run({
            action: "add_project",
            name: sourceDir.split("/").at(-1) ?? sourceDir,
            path: sourceDir,
          })) as { projectId: string }
        ).projectId;
      await run({
        action: "create_thread",
        projectId,
        title: "Update from source",
        message: updatePrompt,
      });
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start the update",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    }
  };

  return { available, start };
}
