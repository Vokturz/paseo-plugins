import { Linking } from "react-native";
import { peerAgentNavigationTarget } from "../shared/agent-link";

export function openPeerAgent(serverId: string, agentId: string, platform: "ios" | "android" | "web") {
  const target = peerAgentNavigationTarget(serverId, agentId, platform);
  if (target.kind === "internal") {
    // Electron serves the app from paseo://app/. Opening a paseo://h/... URL
    // through Linking launches another window on the wrong protocol host.
    // A relative route stays inside the current app on desktop and browser.
    window.location.assign(target.url);
    return;
  }
  void Linking.openURL(target.url);
}
