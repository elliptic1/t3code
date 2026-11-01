import {
  type AtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";
import { Alert } from "react-native";

import { useAtomCommand } from "../../state/use-atom-command";

/** Queue sheets must surface rejected commands; atom command reporting only logs them. */
export function useThreadQueueCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  failureTitle: string,
) {
  const execute = useAtomCommand(command);
  return useCallback(
    async (input: W) => {
      const result = await execute(input);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        Alert.alert(
          failureTitle,
          failure instanceof Error
            ? failure.message
            : "Please check your connection and try again.",
        );
      }
      return result;
    },
    [execute, failureTitle],
  );
}
