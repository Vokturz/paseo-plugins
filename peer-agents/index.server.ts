import type { PluginServerContext } from "@getpaseo/plugin/server";
import { peerMcpRuntime } from "./server/mcp-runtime";

// Paseo 0.9.1 cannot preapprove exact MCP tools for Pi. Injecting the server
// there makes unattended Pi agent creation fail, so leave Pi sessions alone.
const SUPPORTED_PROVIDERS = new Set(["claude", "codex", "opencode"]);
const PEER_TOOLS = ["list_peer_projects", "create_peer_agent", "send_peer_message"];

export default function contribute(server: PluginServerContext) {
  const command = `(${peerMcpRuntime.toString()})()`;

  server.before("agent.create", ({ request }) => {
    if (request.config.internal || !SUPPORTED_PROVIDERS.has(request.config.provider)) return request;
    const preapproved = request.config.toolPolicy?.preapproved ?? [];
    const peerGrants = PEER_TOOLS
      .filter((tool) => !preapproved.some((grant) => grant.kind === "mcp" && grant.server === "peer-agents" && grant.tool === tool))
      .map((tool) => ({ kind: "mcp" as const, server: "peer-agents", tool }));

    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: {
          ...request.config.mcpServers,
          "peer-agents": {
            type: "stdio",
            command: process.execPath,
            args: ["-e", command],
            alwaysLoad: true,
          },
        },
        toolPolicy: { ...request.config.toolPolicy, preapproved: [...preapproved, ...peerGrants] },
      },
    };
  });

  server.before("agent.session_open", ({ request }) => {
    if (!SUPPORTED_PROVIDERS.has(request.provider) || request.purpose !== "interactive") return request;
    return {
      ...request,
      env: {
        ...request.env,
        PASEO_PEER_AGENT_ID: request.agentId,
      },
    };
  });

  return () => {};
}
