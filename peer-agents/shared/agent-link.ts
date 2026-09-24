export function peerAgentRoute(serverId: string, agentId: string) {
  return `/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

export function peerAgentAppLink(serverId: string, agentId: string) {
  return `paseo:/${peerAgentRoute(serverId, agentId)}`;
}
