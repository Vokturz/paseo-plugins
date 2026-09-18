import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TicketDetail } from "../shared/contracts";
import { buildContext, toolData, normalizeIssue, issuePage, record } from "./context";
import { Credentials } from "./credentials";

const endpoint = "https://mcp.linear.app/mcp/readonly";
export interface LinearSession {
  tools: Set<string>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export type Connect = (key: string) => Promise<LinearSession>;

export const connectMcp: Connect = async (key) => {
  const client = new Client({ name: "paseo-linear-tickets", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${key}` }, redirect: "error" },
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30000)]) }),
  });
  try {
    await client.connect(transport, { timeout: 30000 });
    const tools = new Set<string>();
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 30000 });
      page.tools.forEach((tool) => tools.add(tool.name));
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Repeated tool cursor");
      if (cursor) seen.add(cursor);
    } while (cursor);
    for (const name of ["list_issues", "get_issue"]) {
      if (!tools.has(name)) throw new Error(`Missing Linear tool: ${name}`);
    }
    return {
      tools,
      async call(name, args) {
        let result: unknown;
        try { result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30000 }); }
        catch { throw new Error("Linear MCP request failed. Check your connection and ticket access, then retry."); }
        return toolData(result);
      },
      close: () => client.close(),
    };
  } catch {
    await client.close().catch(() => {});
    throw new Error("Could not connect to Linear MCP. Check the API key, its read access, and the host's network connection.");
  }
};

export class LinearService {
  constructor(readonly credentials = new Credentials(), private readonly connect: Connect = connectMcp) {}

  async status() {
    const { key, source } = await this.credentials.read();
    return { connected: Boolean(key), source };
  }

  async authenticate(key: string) {
    const session = await this.connect(key);
    try {
      issuePage(await session.call("list_issues", { assignee: "me", limit: 1, includeArchived: false }));
      await this.credentials.save(key);
    } finally { await session.close().catch(() => {}); }
    return this.status();
  }

  async disconnect() {
    await this.credentials.remove();
    return this.status();
  }

  private async withSession<T>(work: (session: LinearSession) => Promise<T>) {
    const { key } = await this.credentials.read();
    if (!key) throw new Error("Connect Linear before loading tickets.");
    const session = await this.connect(key);
    try { return await work(session); }
    finally { await session.close().catch(() => {}); }
  }

  async issues(cursor?: string) {
    return this.withSession(async (session) => issuePage(await session.call("list_issues", {
      assignee: "me", limit: 50, includeArchived: false, orderBy: "updatedAt", ...(cursor ? { cursor } : {}),
    })));
  }

  async detail(id: string): Promise<TicketDetail> {
    return this.withSession(async (session) => {
      const rawIssue = record(await session.call("get_issue", { id, includeRelations: true }));
      const issue = normalizeIssue(rawIssue);
      const warnings: string[] = [];
      let comments: unknown = [];
      if (session.tools.has("list_comments")) {
        try { comments = await session.call("list_comments", { issueId: issue.id }); }
        catch { warnings.push("Comments could not be loaded; only the ticket details are included."); }
      } else { warnings.push("The Linear connection does not expose comments."); }
      return {
        issue, warnings,
        context: buildContext(rawIssue, comments),
      };
    });
  }
}
