import { useState } from "react";
import type { ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { providerPng } from "./provider-icons";

type Theme = PluginSurfaceProps["theme"];

export function ActionButton({ title, icon, leading, onPress, theme, primary = false, disabled = false, chosen = false }: {
  title: string; icon?: string; leading?: ReactNode; onPress: () => void; theme: Theme;
  primary?: boolean; disabled?: boolean; chosen?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const c = theme.colors;
  const color = primary ? c.accentForeground : chosen ? c.accent : c.foreground;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected: chosen }} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      alignSelf: "flex-start", minHeight: 40, paddingHorizontal: primary ? 18 : 12, paddingVertical: 10, borderRadius: 10,
      borderWidth: 1, borderColor: focused || chosen ? c.accent : primary ? c.accent : c.border,
      backgroundColor: primary ? c.accent : hovered || pressed || chosen ? c.surface2 : c.surface1,
      opacity: disabled ? 0.4 : pressed ? 0.75 : 1 })}>
    {leading ?? (icon && <Icon name={icon} size={15} color={color} />)}
    <Text style={{ color, fontSize: 13, fontWeight: "600" }}>{title}</Text>
  </Pressable>;
}

export function ProviderMark({ provider, theme, size = 18 }: { provider: string; theme: Theme; size?: number }) {
  const normalized = provider.toLowerCase();
  const brand = Object.entries(providerPng).find(([name]) => normalized.includes(name))?.[1];
  return <View style={{ width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, backgroundColor: theme.colors.surface2, alignItems: "center", justifyContent: "center" }}>
    {brand ? <Image accessibilityLabel={provider} source={{ uri: brand }} resizeMode="contain" style={{ width: size, height: size }} /> : <Icon name="Bot" size={size} color={theme.colors.foregroundMuted} />}
  </View>;
}

export function SectionHeading({ title, subtitle, icon, theme }: { title: string; subtitle?: string; icon: string; theme: Theme }) {
  const c = theme.colors;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={18} color={c.accent} />
    </View>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "700" }}>{title}</Text>
      {subtitle && <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{subtitle}</Text>}
    </View>
  </View>;
}

export function FieldLabel({ title, icon, theme }: { title: string; icon: string; theme: Theme }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 }}>
    <Icon name={icon} size={14} color={theme.colors.foregroundMuted} />
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{title}</Text>
  </View>;
}

export function StatusBadge({ status, theme }: { status: string; theme: Theme }) {
  const c = theme.colors;
  const name = status.toLowerCase();
  const done = /^(done|completed|closed)$/.test(name);
  const active = /progress|review|started/.test(name);
  const color = done ? c.statusSuccess : active ? c.statusWarning : c.foregroundMuted;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: c.surface2, maxWidth: "100%" }}>
    <Icon name={done ? "CheckCircle" : active ? "CircleDot" : "Circle"} size={12} color={color} />
    <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: "600", flexShrink: 1 }}>{status || "No status"}</Text>
  </View>;
}
