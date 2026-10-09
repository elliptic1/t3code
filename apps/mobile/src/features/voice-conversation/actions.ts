import { randomUUID } from "expo-crypto";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { createVoiceActionBindings } from "@t3tools/client-runtime/voice-conversation/actions";
export { voiceResult } from "@t3tools/client-runtime/voice-conversation/actions";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { projectEnvironment, environmentProjects } from "../../state/projects";
import { threadEnvironment, environmentThreadShells } from "../../state/threads";
import { waitForProject } from "../../state/entities";

function waitForThreadShell(ref: ScopedThreadRef): Promise<boolean> {
  const atom = environmentThreadShells.threadShellAtom(ref);
  if (appAtomRegistry.get(atom)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, 10000);
    const check = () => {
      if (!appAtomRegistry.get(atom)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    };
    unsubscribe = appAtomRegistry.subscribe(atom, check);
    check();
  });
}
export const { createVoiceActions, createVoiceSessionCommand } = createVoiceActionBindings({
  connectionAtomRuntime,
  appAtomRegistry,
  serverEnvironment,
  projectEnvironment,
  threadEnvironment,
  randomUUID,
  waitForProject,
  waitForThreadShell,
  readProjects: () => appAtomRegistry.get(environmentProjects.projectsAtom),
  readThreadShells: () => appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
  readThreadShell: (ref) => appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref)),
});
