import type { PaseoAgent } from "@getpaseo/client";
import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { Linking, Platform } from "react-native";
import { linearAgentReference } from "./agent-reference";
import { openExternalUrl } from "./open-link";
import { LinearButtonIcon } from "./linear-icon";

/** Keeps an agent-specific Linear badge attached to the sticky composer area. */
export function installLinearAgentBadges(client: PluginClientContext): () => void {
  const registrations = new Map<string, { signature: string; button: PluginButtonRegistration }>();
  let disposed = false;

  const remove = (agentId: string) => {
    registrations.get(agentId)?.button.remove();
    registrations.delete(agentId);
  };

  const sync = (agent: PaseoAgent) => {
    const reference = linearAgentReference(agent.labels);
    const workspaceId = agent.workspaceId;
    if (!reference || !workspaceId || agent.archivedAt) { remove(agent.id); return; }
    const signature = `${workspaceId}\n${reference.identifier}\n${reference.url}`;
    if (registrations.get(agent.id)?.signature === signature) return;
    remove(agent.id);
    const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";
    const button = client.addComposerPill({
      id: `linear-ticket-${agent.id}`,
      workspaceId,
      agentId: agent.id,
      button: {
        title: `Open ${reference.identifier} in Linear`,
        label: reference.identifier,
        icon: LinearButtonIcon,
        behavior: { kind: "action", onPress: () => openExternalUrl(reference.url, { platform, linking: Linking }) },
      },
    });
    registrations.set(agent.id, { signature, button });
  };

  // Existing active agents receive their pill when the plugin loads. Agent updates keep
  // the set current and remove pills immediately when an agent is archived or deleted.
  void (async () => {
    let cursor: string | undefined;
    do {
      const page = await client.paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      if (disposed) return;
      for (const { agent } of page.entries) sync(agent);
      cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    } while (cursor);
  })().catch(() => { /* The ticket surface still works if badges cannot be restored. */ });

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") sync(update.agent);
    else remove(update.agentId);
  });

  return () => {
    disposed = true;
    unsubscribe();
    for (const { button } of registrations.values()) button.remove();
    registrations.clear();
  };
}
