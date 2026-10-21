import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import type { z } from "zod";
import type { ticketIntroCardSchema } from "../shared/ticket-intro";
import { tokensFor } from "./design";
import { openExternalUrl } from "./open-link";
import { ActionButton, BrandMark, Callout, Disclosure, PriorityMark, StatusBadge } from "./ui";

export function TicketIntroCard({ item, theme, layout }: PluginTimelineItemProps<z.infer<typeof ticketIntroCardSchema>>) {
  const { intro, message } = item.data;
  const [linkError, setLinkError] = useState<string | null>(null);
  const t = tokensFor(theme, layout);
  return <View style={{ ...t.card, alignSelf: "stretch", gap: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <BrandMark brand="linear" label="Linear" theme={theme} size={20} />
      <Text style={{ ...t.eyebrow, flex: 1 }}>LINEAR · TICKET AGENT</Text>
    </View>
    <View style={{ gap: 8 }}>
      <Text selectable style={{ ...t.label, color: t.colors.accent }}>{intro.identifier}</Text>
      <Text selectable style={t.cardTitle}>{intro.title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <StatusBadge status={intro.status} statusType={intro.statusType} t={t} />
        <PriorityMark priority={intro.priority} t={t} showLabel />
      </View>
      {!!(intro.project || intro.team) && <Text style={t.muted}>{[intro.project, intro.team].filter(Boolean).join(" · ")}</Text>}
    </View>
    <View style={{ padding: 12, borderRadius: t.radius.md, backgroundColor: t.colors.surface0, gap: 4 }}>
      <Text style={t.label}>{intro.linearAccess ? "Linear tools enabled" : "Linear access disabled"}</Text>
      <Text style={t.muted}>{intro.linearAccess ? "The agent can comment, update status, and attach links to this ticket." : "The agent was instructed to leave Linear unchanged unless you ask."}</Text>
    </View>
    {!!intro.focus && <View style={{ gap: 4 }}><Text style={t.label}>Additional direction</Text><Text style={t.body}>{intro.focus}</Text></View>}
    <ActionButton t={t} title="Open ticket in Linear" icon="ExternalLink" onPress={() => {
      setLinkError(null);
      void openExternalUrl(intro.url, { platform: layout.platform, linking: Linking }).catch(() => setLinkError("Could not open the ticket. Try again."));
    }} />
    {linkError && <Callout t={t} tone="danger" message={linkError} />}
    <Disclosure title="Full instructions and context" t={t}>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 360, backgroundColor: t.colors.surface0, borderRadius: t.radius.md }} contentContainerStyle={{ padding: 12 }}>
        <Text selectable style={t.mono}>{message}</Text>
      </ScrollView>
    </Disclosure>
  </View>;
}
