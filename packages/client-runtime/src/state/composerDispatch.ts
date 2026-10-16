/**
 * How a composer submission is delivered when the thread already has a turn in
 * flight. Shared by web (where the alternate is Mod+Enter) and mobile (where it
 * is a long-press on the send button), so both clients agree on what the user's
 * configured follow-up behavior means.
 */
export type ComposerDispatchMode = "auto" | "queue" | "steer" | "restart" | "parallel";
export type ActiveTurnComposerAction = Exclude<ComposerDispatchMode, "auto">;

export function resolveComposerDispatchMode(input: {
  readonly running: boolean;
  readonly alternateModifier: boolean;
  readonly activeTurnDefault?: Exclude<ActiveTurnComposerAction, "parallel">;
  /** False while the active turn cannot take steering input, such as during compaction. */
  readonly canSteer?: boolean;
}): ComposerDispatchMode {
  if (!input.running) return "auto";
  if (input.canSteer === false) return "queue";
  const defaultAction = input.activeTurnDefault ?? "steer";
  if (input.alternateModifier) return defaultAction === "queue" ? "steer" : "queue";
  return defaultAction;
}

export function alternateComposerDispatchAction(
  activeTurnDefault?: Exclude<ActiveTurnComposerAction, "parallel">,
): ActiveTurnComposerAction {
  return resolveComposerDispatchMode({
    running: true,
    alternateModifier: true,
    ...(activeTurnDefault === undefined ? {} : { activeTurnDefault }),
  }) as ActiveTurnComposerAction;
}
