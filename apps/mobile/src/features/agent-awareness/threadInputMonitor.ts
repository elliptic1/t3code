import { Atom } from "effect/reactivity";
import { AppState } from "react-native";
import { environmentCatalog } from "../../connection/catalog";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentShell } from "../../state/shell";
import { environmentThreadDetails, environmentThreadShells } from "../../state/threads";
import { syncAndroidThreadInputs } from "./androidNotifications";
import { threadInputNotifications } from "./threadInputNotification";

const snapshotAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const threads = get(environmentThreadShells.quietThreadShellsAtom);
  const environments = [...catalog.entries].filter(([, entry]) => entry.enabled).map(([id]) => id);
  const readyEnvironments = environments.filter(
    (id) => get(environmentShell.stateValueAtom(id)).status === "live",
  );
  const incomplete = new Set<string>();
  const items = threads.flatMap((thread) => {
    if (
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      !readyEnvironments.includes(thread.environmentId)
    )
      return [];
    if (
      thread.source.pendingRuntimeRequest === null ||
      thread.source.pendingRuntimeRequest.kind === "auth_refresh"
    )
      return [];
    const ref = { environmentId: thread.environmentId, threadId: thread.id };
    const pending = get(environmentThreadDetails.pendingRequestsAtom(ref));
    if (!pending || get(environmentThreadDetails.statusAtom(ref)) !== "live") {
      incomplete.add(thread.environmentId);
      return [];
    }
    return threadInputNotifications(thread, pending);
  });
  return {
    items,
    environmentIds: environments,
    readyEnvironments: readyEnvironments.filter((id) => !incomplete.has(id)),
    catalogReady: catalog.isReady,
  };
}).pipe(Atom.withEquality((a, b) => JSON.stringify(a) === JSON.stringify(b)));

export function retainThreadInputNotifications(): () => void {
  const update = () => syncAndroidThreadInputs(appAtomRegistry.get(snapshotAtom));
  const unsubscribe = appAtomRegistry.subscribe(snapshotAtom, update);
  const appState = AppState.addEventListener("change", update);
  update();
  return () => {
    unsubscribe();
    appState.remove();
  };
}
