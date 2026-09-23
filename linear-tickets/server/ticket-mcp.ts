import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TICKET_MCP_SOURCE } from "./ticket-mcp-source";

export const TICKET_MCP_NAME = "linear_ticket";
export type TicketMcpServer = { type: "stdio"; command: string; args: string[] };

export function paseoHome(): string {
  return process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo");
}

// Content-addressed so agents created by an older plugin version keep a working script.
export async function writeTicketMcpScript(home = paseoHome(), source = TICKET_MCP_SOURCE): Promise<string> {
  const directory = join(home, "linear-tickets");
  const path = join(directory, `ticket-mcp-${createHash("sha256").update(source).digest("hex").slice(0, 12)}.mjs`);
  if (await readFile(path, "utf8").then((current) => current === source, () => false)) return path;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, source, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
  return path;
}

// Only the issue id and a path go into the saved agent config; the key is read at call time.
export function ticketMcpServer(scriptPath: string, issueId: string, home = paseoHome()): TicketMcpServer {
  return { type: "stdio", command: "node", args: [scriptPath, "--issue", issueId, "--paseo-home", home] };
}
