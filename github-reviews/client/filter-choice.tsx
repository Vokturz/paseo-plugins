import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

type Theme = PluginSurfaceProps["theme"];

export function ChoiceGrid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", margin: -4 }}>{children}</View>;
}

export function FilterChoice({ theme, label, icon, checked, onPress, disabled = false, radio = false }: {
  theme: Theme; label: string; icon?: string; checked: boolean; onPress: () => void; disabled?: boolean; radio?: boolean;
}) {
  const c = theme.colors;
  return <View style={{ width: "50%", padding: 4 }}>
    <Pressable accessibilityRole={radio ? "radio" : "checkbox"} accessibilityLabel={label} accessibilityState={{ checked, disabled }}
      disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 9, flex: 1, minHeight: 48, padding: 12,
        borderRadius: 10, borderWidth: 1, borderColor: checked ? c.accent : c.border, backgroundColor: checked || pressed ? c.surface2 : c.surface0, opacity: disabled ? 0.45 : 1 })}>
      {icon && <Icon name={icon} size={16} color={checked ? c.accent : c.foregroundMuted} />}
      <Text style={{ flex: 1, color: checked ? c.accent : c.foreground, fontSize: 13, lineHeight: 19, fontWeight: checked ? "600" : "400" }}>{label}</Text>
      <View style={{ width: 18, height: 18, borderRadius: radio ? 9 : 5, borderWidth: 1, borderColor: checked ? c.accent : c.border, alignItems: "center", justifyContent: "center" }}>
        {checked && (radio ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} /> : <Icon name="Check" size={13} color={c.accent} />)}
      </View>
    </Pressable>
  </View>;
}
