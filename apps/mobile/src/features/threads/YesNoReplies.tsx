import { View } from "react-native";

import { RequestActionButton } from "./RequestActionButton";

/** One-tap answers above the composer when the agent's last message asks a yes/no question. */
export function YesNoReplies(props: { readonly onReply: (text: "Yes" | "No") => void }) {
  return (
    <View className="flex-row justify-end gap-2 px-4 pb-2">
      <RequestActionButton label="No" tone="secondary" onPress={() => props.onReply("No")} />
      <RequestActionButton label="Yes" onPress={() => props.onReply("Yes")} />
    </View>
  );
}
