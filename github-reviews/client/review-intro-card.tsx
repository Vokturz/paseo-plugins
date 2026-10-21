import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { z } from "zod";
import type { reviewIntroCardSchema } from "../shared/review-intro";
import { tokensFor } from "./design";

export function ReviewIntroCard({ item, theme, layout }: PluginTimelineItemProps<z.infer<typeof reviewIntroCardSchema>>) {
  const { intro, message } = item.data;
  const [expanded, setExpanded] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const t = tokensFor(theme, layout), c = t.colors;
  return <View style={{ alignSelf: "stretch", borderWidth: 1, borderColor: c.border, borderRadius: 14,
    padding: layout.compact ? 14 : 18, gap: 12, backgroundColor: c.surface1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name="GitPullRequest" size={17} color={c.accent} />
      <Text style={{ ...t.eyebrow, color: c.accent, flex: 1 }}>GITHUB · CODE REVIEW</Text>
      <Text style={{ fontSize: 11, color: intro.reviewOnly ? c.statusWarning : c.foregroundMuted,
        backgroundColor: c.surface2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>{intro.reviewOnly ? "Review only · draft" : "PR review"}</Text>
    </View>
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${intro.repository} #${intro.number}: ${intro.title}`}
      onPress={() => { setLinkError(null); void openExternalUrl(intro.url).catch(() => setLinkError("Could not open the pull request. Try again.")); }} style={{ gap: 5 }}>
      <Text style={{ color: c.foreground, fontSize: layout.compact ? 17 : 19, fontWeight: "600", lineHeight: 25 }}>{intro.title}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ ...t.muted, color: c.accent, flexShrink: 1 }}>{intro.repository} #{intro.number}</Text>
        <Icon name="ExternalLink" size={12} color={c.accent} />
      </View>
    </Pressable>
    <View style={{ gap: 6, padding: 11, borderRadius: 10, backgroundColor: c.surface0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
        <Icon name="GitBranch" size={13} color={c.foregroundMuted} />
        <Text selectable style={{ ...t.mono, flexShrink: 1 }}>{intro.headRef}</Text>
        <Icon name="ArrowRight" size={12} color={c.foregroundMuted} />
        <Text selectable style={{ ...t.mono, flexShrink: 1 }}>{intro.baseRef}</Text>
      </View>
      <Text style={t.muted}>Isolated worktree · head {intro.headSha.slice(0, 8)} · base {intro.baseSha.slice(0, 8)}</Text>
    </View>
    {intro.focus && <View style={{ gap: 4 }}>
      <Text style={t.label}>Additional focus</Text>
      <Text style={t.body}>{intro.focus}</Text>
    </View>}
    <Text style={t.muted}>{intro.reviewOnly ? "Findings stay in the agent conversation. This run does not publish to GitHub." : "Uses your saved reviewer instructions. Publication follows your review prompt."}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Hide full launch message" : "Show full launch message"}
      accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, alignSelf: "flex-start" }}>
      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={13} color={c.foregroundMuted} />
      <Text style={t.muted}>{expanded ? "Hide full launch message" : "Full instructions and context"}</Text>
    </Pressable>
    {expanded && <ScrollView nestedScrollEnabled style={{ maxHeight: 360, backgroundColor: c.surface0, borderRadius: 10 }} contentContainerStyle={{ padding: 12 }}>
      <Text selectable style={{ ...t.mono, lineHeight: 19 }}>{message}</Text>
    </ScrollView>}
    {linkError && <Text accessibilityRole="alert" style={{ ...t.muted, color: c.statusDanger }}>{linkError}</Text>}
  </View>;
}
