import { Pressable } from "react-native";
import { AppText as Text } from "../../components/AppText";
export function VoiceButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className="min-h-11 justify-center px-2 active:opacity-70"
      style={{ opacity: props.disabled ? 0.4 : 1 }}
    >
      <Text className="text-sm text-primary">{props.label}</Text>
    </Pressable>
  );
}
