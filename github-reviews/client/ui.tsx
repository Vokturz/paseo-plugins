// Uses the same form primitives and visual tokens as Linear tickets.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Animated, Image, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { Tokens } from "./design";
import { providerPng } from "./provider-icons";

type Theme = PluginSurfaceProps["theme"];

const SurfaceContext = createContext<{ t: Tokens; busy: boolean } | null>(null);

/** Shares the surface tokens and its global busy flag so every action button dims consistently. */
export function SurfaceProvider({ t, busy, children }: { t: Tokens; busy: boolean; children: ReactNode }) {
  return <SurfaceContext.Provider value={{ t, busy }}>{children}</SurfaceContext.Provider>;
}

export interface ActionButtonProps {
  title: string; icon?: string; leading?: ReactNode; onPress: () => void;
  primary?: boolean; disabled?: boolean; chosen?: boolean; tone?: "default" | "danger";
  size?: "sm" | "md"; iconOnly?: boolean; stretch?: boolean;
}

/** ActionButton bound to the surrounding surface tokens. */
export function Button(props: ActionButtonProps) {
  const surface = useContext(SurfaceContext);
  if (!surface) throw new Error("Button must be rendered inside a SurfaceProvider.");
  return <ActionButton {...props} t={surface.t} disabled={props.disabled || surface.busy} />;
}

export function ActionButton({ title, icon, leading, onPress, t, primary = false, disabled = false, chosen = false, tone = "default", size = "md", iconOnly = false, stretch = false }: ActionButtonProps & { t: Tokens }) {
  const [hovered, setHovered] = useState(false);
  const c = t.colors;
  const color = primary ? c.accentForeground : tone === "danger" ? c.statusDanger : chosen ? c.accent : c.foreground;
  const active = hovered || chosen;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled, selected: chosen }} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => ({
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
      alignSelf: stretch ? "stretch" : "flex-start", minHeight: size === "sm" ? 32 : 40,
      paddingHorizontal: iconOnly ? 0 : size === "sm" ? 10 : primary ? 16 : 12,
      width: iconOnly ? (size === "sm" ? 32 : 40) : undefined,
      borderRadius: t.radius.md, borderWidth: 1,
      // Selection is the only persistent accent state. React Native Web can retain
      // focus after another filter is pressed, which otherwise makes two chips look selected.
      borderColor: chosen || primary ? c.accent : c.border,
      backgroundColor: primary ? c.accent : active || pressed ? c.surface2 : c.surface1,
      opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
    })}>
    {leading ?? (icon ? <Icon name={icon} size={size === "sm" ? 13 : 15} color={color} /> : null)}
    {!iconOnly && <Text style={{ color, fontSize: size === "sm" ? 12 : 13, fontWeight: "600" }}>{title}</Text>}
  </Pressable>;
}

// Brand marks ship their own colors, so they sit on a neutral chip instead of the accent fill.
export function BrandMark({ brand, label, theme, size = 18, radius }: { brand: string; label?: string; theme: Theme; size?: number; radius?: number }) {
  const uri = providerPng[brand];
  const box = size + 8;
  return <View style={{ width: box, height: box, borderRadius: radius ?? box / 2, backgroundColor: theme.colors.surface2, alignItems: "center", justifyContent: "center" }}>
    {uri ? <Image accessibilityLabel={label ?? brand} source={{ uri }} resizeMode="contain" style={{ width: size, height: size, ...(brand === "linear" ? { tintColor: theme.colors.foreground } : {}) }} /> : <Icon name="Bot" size={size} color={theme.colors.foregroundMuted} />}
  </View>;
}

export function ProviderMark({ provider, theme, size = 18 }: { provider: string; theme: Theme; size?: number }) {
  const normalized = provider.toLowerCase();
  const brand = Object.keys(providerPng).find((name) => normalized.includes(name));
  return <BrandMark brand={brand ?? ""} label={provider} theme={theme} size={size} />;
}

export function SectionHeading({ title, subtitle, icon, trailing, t }: { title: string; subtitle?: string; icon: string; trailing?: ReactNode; t: Tokens }) {
  const c = t.colors;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
    <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={17} color={c.accent} />
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={t.heading}>{title}</Text>
      {subtitle && <Text style={t.muted}>{subtitle}</Text>}
    </View>
    {trailing}
  </View>;
}

export function FieldLabel({ title, icon, hint, t }: { title: string; icon?: string; hint?: string; t: Tokens }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    {icon && <Icon name={icon} size={12} color={t.colors.foregroundMuted} />}
    <Text style={{ ...t.eyebrow, letterSpacing: 1.1 }}>{title}</Text>
    {hint && <Text style={{ ...t.muted, fontSize: 11 }}>· {hint}</Text>}
  </View>;
}

export function Divider({ t, spaced = false }: { t: Tokens; spaced?: boolean }) {
  return <View style={{ ...t.divider, marginVertical: spaced ? 8 : 2 }} />;
}

export function Callout({ message, t, tone = "warning", action }: { message: string; t: Tokens; tone?: "warning" | "danger" | "info"; action?: ReactNode }) {
  const color = tone === "danger" ? t.colors.statusDanger : tone === "info" ? t.colors.accent : t.colors.statusWarning;
  const icon = tone === "danger" ? "CircleAlert" : tone === "info" ? "Info" : "TriangleAlert";
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: t.colors.surface0, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, borderLeftWidth: 3, borderLeftColor: color, padding: 12 }}>
    <Icon name={icon} size={14} color={color} />
    <Text style={{ ...t.muted, flex: 1 }}>{message}</Text>
    {action && <View style={{ flexShrink: 0 }}>{action}</View>}
  </View>;
}

export function Skeleton({ t, width, height = 12, radius = 6 }: { t: Tokens; width: number | `${number}%`; height?: number; radius?: number }) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.45, duration: 750, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: t.colors.surface2, opacity }} />;
}
