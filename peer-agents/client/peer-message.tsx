import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { openPeerAgent } from "./agent-link";
import { tokensFor } from "./design";
import { MarkdownPreview } from "./markdown-preview";
import { parsePeerMessage } from "../shared/peer-message";

export { parsePeerMessage };

export const peerMessageSchema = z.object({
  fromAgentId: z.string(),
  message: z.string(),
});

export function PeerMessageCard({ item, theme, host, layout }: PluginTimelineItemProps<z.output<typeof peerMessageSchema>>) {
  const tokens = tokensFor(theme, layout);
  return (
    <View style={{
      alignSelf: "stretch",
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      borderWidth: 1,
      gap: 8,
      padding: layout.compact ? 12 : 16,
    }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <Icon name="Bot" size={16} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontWeight: "600", flex: 1 }}>Peer agent</Text>
        <Pressable accessibilityRole="link" accessibilityLabel="Open sending agent" onPress={() => openPeerAgent(host.id, item.data.fromAgentId, layout.platform)}>
          <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Open agent ↗</Text>
        </Pressable>
      </View>
      <MarkdownPreview markdown={item.data.message} t={tokens} platform={layout.platform} />
    </View>
  );
}
