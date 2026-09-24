import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { openPeerAgent } from "./agent-link";
import { tokensFor } from "./design";
import { MarkdownPreview } from "./markdown-preview";
import { parsePeerCreation } from "../shared/peer-creation";

export { parsePeerCreation };

export const peerCreationSchema = z.object({
  status: z.enum(["creating", "created"]),
  agentId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  projectName: z.string().nullable(),
  task: z.string(),
  title: z.string().nullable(),
});

export function PeerCreationCard({ item, theme, host, layout }: PluginTimelineItemProps<z.output<typeof peerCreationSchema>>) {
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
        <Text style={{ color: theme.colors.accent, fontWeight: "600", flex: 1 }}>
          {item.data.status === "creating" ? "Creating peer agent…" : "Peer agent created"}
        </Text>
        {item.data.agentId ? (
          <Pressable accessibilityRole="link" accessibilityLabel="Open new peer agent" onPress={() => openPeerAgent(host.id, item.data.agentId!, layout.platform)}>
            <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Open agent ↗</Text>
          </Pressable>
        ) : null}
      </View>
      {item.data.title ? <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{item.data.title}</Text> : null}
      {item.data.projectName ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{item.data.projectName}</Text> : null}
      <MarkdownPreview markdown={item.data.task} t={tokens} platform={layout.platform} />
    </View>
  );
}
