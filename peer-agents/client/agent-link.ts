import { Linking } from "react-native";
import { peerAgentAppLink, peerAgentRoute } from "../shared/agent-link";

export function openPeerAgent(serverId: string, agentId: string, platform: "ios" | "android" | "web") {
  const route = peerAgentRoute(serverId, agentId);
  if (platform === "web" && (window.location.protocol === "http:" || window.location.protocol === "https:")) {
    window.location.assign(route);
    return;
  }
  void Linking.openURL(peerAgentAppLink(serverId, agentId));
}
