export function peerAgentRoute(serverId: string, agentId: string) {
  return `/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

export function peerAgentAppLink(serverId: string, agentId: string) {
  return `paseo:/${peerAgentRoute(serverId, agentId)}`;
}

export function peerAgentNavigationTarget(serverId: string, agentId: string, platform: "ios" | "android" | "web") {
  return platform === "web"
    ? { kind: "internal" as const, url: peerAgentRoute(serverId, agentId) }
    : { kind: "external" as const, url: peerAgentAppLink(serverId, agentId) };
}
