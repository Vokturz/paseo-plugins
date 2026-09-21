import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Linking, Text, View } from "react-native";
import type { z } from "zod";
import { linearTicketTimelineSchema } from "../shared/timeline";
import { tokensFor } from "./design";
import { openExternalUrl } from "./open-link";
import { BrandMark, Button, SurfaceProvider } from "./ui";

type TicketLink = z.infer<typeof linearTicketTimelineSchema>;

export function LinearTicketTimelineCard({ item, theme, layout }: PluginTimelineItemProps<TicketLink>) {
  const data = item.data;
  const t = tokensFor(theme, layout);
  return <SurfaceProvider t={t} busy={false}><View style={{ ...t.card, gap: 12, borderLeftWidth: 3, borderLeftColor: t.colors.accent }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
      <BrandMark brand="linear" label="Linear" theme={theme} size={19} radius={10} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ ...t.eyebrow, color: t.colors.accent }}>Linear ticket · {data.identifier}</Text>
        <Text numberOfLines={2} style={t.strong}>{data.title}</Text>
      </View>
    </View>
    <Button title={`Open ${data.identifier} in Linear`} icon="ExternalLink" size="sm"
      onPress={() => void openExternalUrl(data.url, { platform: layout.platform, linking: Linking })} />
  </View></SurfaceProvider>;
}
