import { createVoiceActionBindings } from "@t3tools/client-runtime/voice-conversation/actions";
export { voiceResult } from "@t3tools/client-runtime/voice-conversation/actions";
import { randomUUID } from "../lib/utils";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { projectEnvironment } from "../state/projects";
import { threadEnvironment } from "../state/threads";
import {
  readProjects,
  readThreadShell,
  readThreadShells,
  waitForProject,
  waitForThreadShell,
} from "../state/entities";

export const { createVoiceActions, createVoiceSessionCommand } = createVoiceActionBindings({
  connectionAtomRuntime,
  appAtomRegistry,
  serverEnvironment,
  projectEnvironment,
  threadEnvironment,
  randomUUID,
  readProjects,
  readThreadShell,
  readThreadShells,
  waitForProject,
  waitForThreadShell,
});
