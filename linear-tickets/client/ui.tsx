import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Animated, Image, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { Tokens } from "./design";
import { formatPriority, hasPriority, priorityTone, statusIcon, statusTone, type PriorityTone, type StatusIconKind, type StatusTone } from "./issue-list";
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

const STATUS_TONES: Record<StatusTone, { color: (t: Tokens) => string; dim?: boolean }> = {
  done: { color: (t) => t.colors.statusSuccess },
  canceled: { color: (t) => t.colors.foregroundMuted, dim: true },
  active: { color: (t) => t.colors.statusWarning },
  review: { color: (t) => t.colors.accent },
  backlog: { color: (t) => t.colors.foregroundMuted },
  neutral: { color: (t) => t.colors.foregroundMuted, dim: true },
};

function StatusIcon({ kind, color }: { kind: StatusIconKind; color: string }) {
  if (kind === "Circle") return <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: color }} />;
  if (kind === "CircleFilled") return <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />;
  return <Icon name={kind} size={12} color={color} />;
}

export function StatusMark({ status, statusType = "", t }: { status: string; statusType?: string; t: Tokens }) {
  const tone = STATUS_TONES[statusTone(status, statusType)];
  return <StatusIcon kind={statusIcon(status, statusType)} color={tone.color(t)} />;
}

export function StatusBadge({ status, statusType, t, compact = false }: { status: string; statusType?: string; t: Tokens; compact?: boolean }) {
  const tone = STATUS_TONES[statusTone(status, statusType ?? "")];
  const icon = statusIcon(status, statusType ?? "");
  const color = tone.color(t);
  if (compact) return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" }}>
    <StatusIcon kind={icon} color={color} />
    <Text numberOfLines={1} style={{ color, fontSize: 12, fontWeight: "600", flexShrink: 1, opacity: tone.dim ? 0.85 : 1 }}>{status || "No status"}</Text>
  </View>;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: t.colors.surface2, maxWidth: "100%" }}>
    <StatusIcon kind={icon} color={color} />
    <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: "600", flexShrink: 1, opacity: tone.dim ? 0.85 : 1 }}>{status || "No status"}</Text>
  </View>;
}

export function Segmented<Value extends string>({ label, options, value, onChange, t, disabled = false }: {
  label: string; options: { value: Value; label: string; icon?: string }[]; value: Value; onChange: (value: Value) => void; t: Tokens; disabled?: boolean;
}) {
  return <View accessibilityLabel={label} style={{ flexDirection: "row", backgroundColor: t.colors.surface0, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, padding: 3, gap: 3, alignSelf: "flex-start" }}>
    {options.map((option) => {
      const chosen = option.value === value;
      return <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={`${label}: ${option.label}`} accessibilityState={{ selected: chosen, disabled }} disabled={disabled} onPress={() => onChange(option.value)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: t.radius.sm,
          backgroundColor: chosen ? t.colors.surface2 : pressed ? t.colors.surface1 : "transparent", opacity: disabled ? 0.45 : 1 }) }>
        {option.icon && <Icon name={option.icon} size={12} color={chosen ? t.colors.accent : t.colors.foregroundMuted} />}
        <Text style={{ color: chosen ? t.colors.accent : t.colors.foregroundMuted, fontSize: 12, fontWeight: chosen ? "700" : "600" }}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export function statusAccent(status: string, statusType: string, t: Tokens) {
  return STATUS_TONES[statusTone(status, statusType)].color(t);
}

const PRIORITY_TONES: Record<PriorityTone, { icon: string; color: (t: Tokens) => string }> = {
  urgent: { icon: "Flame", color: (t) => t.colors.statusDanger },
  high: { icon: "SignalHigh", color: (t) => t.colors.statusWarning },
  medium: { icon: "SignalMedium", color: (t) => t.colors.accent },
  low: { icon: "SignalLow", color: (t) => t.colors.foregroundMuted },
  none: { icon: "SignalZero", color: (t) => t.colors.foregroundMuted },
};

export function PriorityMark({ priority, t, showLabel = false }: { priority: string; t: Tokens; showLabel?: boolean }) {
  if (!hasPriority(priority)) return showLabel ? <Text style={t.muted}>No priority</Text> : null;
  const label = formatPriority(priority);
  const tone = PRIORITY_TONES[priorityTone(priority)];
  const color = tone.color(t);
  return <View accessibilityLabel={`Priority: ${label}`} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <Icon name={tone.icon} size={13} color={color} />
    {showLabel && <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{label}</Text>}
  </View>;
}

export function LabelChip({ label, t }: { label: string; t: Tokens }) {
  return <View style={{ ...t.chip, backgroundColor: t.colors.surface2, borderColor: "transparent", flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 190 }}>
    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.colors.accent }} />
    <Text numberOfLines={1} style={{ color: t.colors.foregroundMuted, fontSize: 11, fontWeight: "500" }}>{label}</Text>
  </View>;
}

export function MetaItem({ icon, label, value, t, chips }: { icon: string; label: string; value?: string; t: Tokens; chips?: string[] }) {
  return <View style={{ flexBasis: 160, flexGrow: 1, gap: 5, minWidth: 140 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Icon name={icon} size={11} color={t.colors.foregroundMuted} />
      <Text style={{ ...t.eyebrow, letterSpacing: 1, fontSize: 9.5 }}>{label}</Text>
    </View>
    {chips?.length
      ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>{chips.map((chip) => <LabelChip key={chip} label={chip} t={t} />)}</View>
      : <Text numberOfLines={2} style={t.strong}>{value || "—"}</Text>}
  </View>;
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

export function EmptyState({ icon, title, description, t, action }: { icon: string; title: string; description: string; t: Tokens; action?: ReactNode }) {
  return <View style={{ ...t.card, paddingVertical: 40, alignItems: "center", gap: 10 }}>
    <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: t.colors.surface2, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={24} color={t.colors.accent} />
    </View>
    <Text style={t.heading}>{title}</Text>
    <Text style={{ ...t.muted, textAlign: "center", maxWidth: 420 }}>{description}</Text>
    {action}
  </View>;
}
