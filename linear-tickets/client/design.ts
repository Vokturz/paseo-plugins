import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

type Theme = PluginSurfaceProps["theme"];
type Layout = PluginSurfaceProps["layout"];

/**
 * Shared visual tokens. Keeping spacing, radii, type and surfaces in one place is what makes the
 * surface look deliberate: every card, chip and label is derived from the same scale instead of
 * re-inventing padding and font sizes inline.
 */
export function tokensFor(theme: Theme, layout: Layout) {
  const c = theme.colors;
  const compact = layout.compact;
  return {
    compact,
    colors: c,
    radius: { sm: 8, md: 10, lg: 14, xl: 18 },
    card: {
      backgroundColor: c.surface1,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      padding: compact ? 16 : 22,
    },
    input: {
      color: c.foreground,
      backgroundColor: c.surface0,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontSize: 14,
    },
    focusRing: { borderColor: c.accent },
    eyebrow: { color: c.foregroundMuted, fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.6 },
    title: { color: c.foreground, fontSize: compact ? 24 : 28, fontWeight: "700" as const, letterSpacing: -0.6 },
    cardTitle: { color: c.foreground, fontSize: compact ? 20 : 22, fontWeight: "700" as const, letterSpacing: -0.3, lineHeight: compact ? 27 : 30 },
    heading: { color: c.foreground, fontSize: 16, fontWeight: "700" as const },
    body: { color: c.foreground, fontSize: 14, lineHeight: 22 },
    strong: { color: c.foreground, fontSize: 14, fontWeight: "600" as const, lineHeight: 21 },
    label: { color: c.foreground, fontSize: 12, fontWeight: "600" as const },
    muted: { color: c.foregroundMuted, fontSize: 12.5, lineHeight: 19 },
    mono: { color: c.foreground, fontFamily: "monospace", fontSize: 11.5, lineHeight: 18 },
    divider: { height: 1, backgroundColor: c.border },
    chip: { borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: 9, paddingVertical: 3 },
  } as const;
}

export type Tokens = ReturnType<typeof tokensFor>;