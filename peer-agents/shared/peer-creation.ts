export interface PeerCreation {
  status: "creating" | "created";
  agentId: string | null;
  workspaceId: string | null;
  projectName: string | null;
  task: string;
  title: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function creationResult(output: unknown): Record<string, unknown> | null {
  const result = jsonRecord(output);
  if (!result || result.isError === true) return null;
  const structured = jsonRecord(result.structuredContent);
  if (structured?.agentId) return structured;
  if (result.agentId) return result;
  if (!Array.isArray(result.content)) return null;
  for (const entry of result.content) {
    const block = record(entry);
    if (block?.type === "text") {
      const parsed = jsonRecord(block.text);
      if (parsed?.agentId) return parsed;
    }
  }
  return null;
}

export function parsePeerCreation(item: unknown): PeerCreation | null {
  const call = record(item);
  if (call?.type !== "tool_call" || typeof call.name !== "string") return null;
  const normalizedName = call.name.replace(/[.-]/g, "_");
  if (!normalizedName.includes("peer_agents") || !normalizedName.endsWith("create_peer_agent")) return null;

  const detail = record(call.detail);
  if (!detail) return null;
  const input = jsonRecord(detail.input ?? detail.arguments);
  if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) return null;
  const task = input.prompt;
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : null;
  if (call.status === "running") {
    return { status: "creating", agentId: null, workspaceId: null, projectName: null, task, title };
  }
  if (call.status !== "completed") return null;
  const result = creationResult(detail.output ?? detail.result ?? detail.text);
  if (!result) return null;
  const agentId = result.agentId;
  const workspaceId = result.workspaceId;
  if (typeof agentId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(agentId)) return null;
  if (typeof workspaceId !== "string" || !workspaceId.trim()) return null;
  return {
    status: "created",
    agentId,
    workspaceId,
    projectName: typeof result.projectName === "string" && result.projectName.trim() ? result.projectName.trim() : null,
    task,
    title,
  };
}
