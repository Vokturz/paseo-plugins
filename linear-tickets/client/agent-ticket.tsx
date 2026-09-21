import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import { Linking, Text, View } from "react-native";
import { tokensFor } from "./design";
import { openExternalUrl } from "./open-link";
import { BrandMark, Button, Callout, FieldLabel, SurfaceProvider } from "./ui";
import { linearAgentReference } from "./agent-reference";

export function AgentLinearTicketPanel({ agentId, theme, layout }: PluginAgentPanelProps) {
  const labels = useAgent(agentId, (agent) => agent.labels);
  const reference = linearAgentReference(labels);
  const t = tokensFor(theme, layout);

  return <SurfaceProvider t={t} busy={false}><View style={{ ...t.card, margin: layout.compact ? 12 : 16, gap: 14 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <BrandMark brand="linear" label="Linear" theme={theme} size={22} radius={10} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.cardTitle}>Linear ticket</Text>
        <Text style={t.muted}>The ticket linked when this agent was created.</Text>
      </View>
    </View>
    {reference ? <>
      <FieldLabel title={reference.identifier} icon="Ticket" hint="linked to this agent" t={t} />
      <Button title="Open ticket in Linear" icon="ExternalLink" primary stretch
        onPress={() => void openExternalUrl(reference.url, { platform: layout.platform, linking: Linking })} />
    </> : <Callout t={t} tone="info" message="This agent was not created from a Linear ticket." />}
  </View></SurfaceProvider>;
}
