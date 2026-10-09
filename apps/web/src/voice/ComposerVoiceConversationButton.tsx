import { AudioLinesIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useVoiceConversationStore } from "./voiceConversationStore";

/** Opens the voice conversation panel; renders nothing when voice is off for the environment. */
export function ComposerVoiceConversationButton() {
  const available = useVoiceConversationStore((state) => state.available);
  const open = useVoiceConversationStore((state) => state.open);
  const running = useVoiceConversationStore((state) => state.running);
  const setOpen = useVoiceConversationStore((state) => state.setOpen);
  if (!available) return null;
  const label = running ? "Show voice conversation" : "Talk to T3";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={running ? "secondary" : "ghost"}
            size="icon-sm"
            aria-expanded={open}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setOpen(!open)}
            aria-label={label}
          />
        }
      >
        <AudioLinesIcon />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
