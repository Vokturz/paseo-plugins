// Stdio MCP server given to agents launched from a ticket. It is written to disk and run
// by `node`, so it is plain dependency-free ESM; it must not contain backticks or "${".
export const TICKET_MCP_SOURCE = String.raw`
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
function arg(name) { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; }
const issueId = arg("--issue");
const paseoHome = arg("--paseo-home");
if (!issueId || !/^[A-Za-z0-9-]{1,100}$/.test(issueId) || !paseoHome) {
  process.stderr.write("linear-ticket MCP: --issue <id> and --paseo-home <path> are required\n");
  process.exit(2);
}
const override = process.env.LINEAR_TICKET_MCP_ENDPOINT;
const endpoint = override && /^http:\/\/127\.0\.0\.1:\d+\//.test(override) ? override : "https://api.linear.app/graphql";
const BLOCKED_TYPES = ["canceled", "duplicate"];

async function apiKey() {
  const fromEnv = (process.env.LINEAR_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const saved = JSON.parse(await readFile(join(paseoHome, "linear-tickets", "credentials.json"), "utf8"));
    if (typeof saved.apiKey === "string" && saved.apiKey.trim()) return saved.apiKey.trim();
  } catch {}
  throw new Error("Linear is not connected on this Paseo host. Ask the user to connect it in the Linear tickets plugin.");
}

async function linear(query, variables) {
  const key = await apiKey();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST", redirect: "error",
      headers: { authorization: key, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error("Could not reach the Linear API."); }
  let payload = null;
  try { payload = await response.json(); } catch {}
  const errors = payload && Array.isArray(payload.errors) ? payload.errors.map((e) => (e && (e.extensions && e.extensions.userPresentableMessage || e.message)) || "").filter(Boolean).join("; ").slice(0, 300) : "";
  if (response.status === 401 || response.status === 403) throw new Error("Linear rejected the host's API key." + (errors ? " " + errors : ""));
  if (!response.ok || errors) throw new Error("The Linear request failed" + (errors ? ": " + errors : " (HTTP " + response.status + ")."));
  return (payload && payload.data) || {};
}

const ISSUE = "query ticket($id: String!) { issue(id: $id) { id identifier title url description priorityLabel state { name type } assignee { name } team { id name states(first: 50) { nodes { id name type position } } } comments(first: 50) { nodes { body createdAt user { name } } } attachments(first: 20) { nodes { title url } } } }";

async function loadIssue() {
  const data = await linear(ISSUE, { id: issueId });
  if (!data.issue) throw new Error("Linear did not return this ticket. Check that the host's key can see it.");
  return data.issue;
}

function states(issue) {
  const nodes = (issue.team && issue.team.states && issue.team.states.nodes) || [];
  return nodes.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
}

const tools = [
  {
    name: "get_ticket",
    description: "Read this agent's Linear ticket fresh from Linear: title, description, current status, the team's workflow states, recent comments and links.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run() {
      const issue = await loadIssue();
      const comments = ((issue.comments && issue.comments.nodes) || []).slice(-20).map((c) => ({ author: c.user ? c.user.name : null, createdAt: c.createdAt, body: c.body }));
      return {
        identifier: issue.identifier, title: issue.title, url: issue.url, status: issue.state, priority: issue.priorityLabel,
        assignee: issue.assignee ? issue.assignee.name : null, team: issue.team ? issue.team.name : null,
        availableStatuses: states(issue).filter((s) => !BLOCKED_TYPES.includes(s.type)).map((s) => ({ name: s.name, type: s.type })),
        description: issue.description, comments, links: (issue.attachments && issue.attachments.nodes) || [],
      };
    },
  },
  {
    name: "add_comment",
    description: "Post a Markdown comment on this agent's Linear ticket. Use it for a short start note, meaningful progress, blockers, and the final summary with the PR link.",
    inputSchema: { type: "object", properties: { body: { type: "string", minLength: 1, maxLength: 20000 } }, required: ["body"], additionalProperties: false },
    async run(input) {
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!body || body.length > 20000) throw new Error("body must be 1 to 20000 characters.");
      const data = await linear("mutation comment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { url } } }", { input: { issueId, body } });
      const result = data.commentCreate || {};
      if (!result.success) throw new Error("Linear did not create the comment.");
      return { posted: true, url: result.comment ? result.comment.url : null };
    },
  },
  {
    name: "set_status",
    description: "Move this agent's Linear ticket to another workflow state of its team, by exact state name (see get_ticket availableStatuses). Canceled and duplicate states are reserved for people.",
    inputSchema: { type: "object", properties: { status: { type: "string", minLength: 1, maxLength: 200 } }, required: ["status"], additionalProperties: false },
    async run(input) {
      const wanted = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
      const issue = await loadIssue();
      const all = states(issue);
      const target = all.find((s) => s.name.trim().toLowerCase() === wanted);
      const allowed = all.filter((s) => !BLOCKED_TYPES.includes(s.type)).map((s) => s.name);
      if (!target) throw new Error("Unknown status. Choose one of: " + allowed.join(", "));
      if (BLOCKED_TYPES.includes(target.type)) throw new Error("Only a person can move a ticket to " + target.name + ".");
      if (issue.state && issue.state.name === target.name) return { changed: false, status: target.name };
      const data = await linear("mutation status($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { state { name } } } }", { id: issueId, stateId: target.id });
      if (!data.issueUpdate || !data.issueUpdate.success) throw new Error("Linear did not apply the status change.");
      return { changed: true, from: issue.state ? issue.state.name : null, status: target.name };
    },
  },
  {
    name: "link_url",
    description: "Attach an https link (for example the pull request) to this agent's Linear ticket.",
    inputSchema: { type: "object", properties: { url: { type: "string", maxLength: 2000 }, title: { type: "string", maxLength: 200 } }, required: ["url"], additionalProperties: false },
    async run(input) {
      let url;
      try { url = new URL(String(input.url)); } catch { throw new Error("url must be an absolute https URL."); }
      if (url.protocol !== "https:") throw new Error("url must be an absolute https URL.");
      const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 200) : undefined;
      const data = await linear("mutation link($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success } }", { issueId, url: url.href, title });
      if (!data.attachmentLinkURL || !data.attachmentLinkURL.success) throw new Error("Linear did not attach the link.");
      return { linked: true, url: url.href };
    },
  },
];

function send(message) { process.stdout.write(JSON.stringify(message) + "\n"); }

async function handle(message) {
  const { id, method, params } = message;
  const reply = (result) => { if (id !== undefined) send({ jsonrpc: "2.0", id, result }); };
  const fail = (code, text) => { if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code, message: text } }); };
  if (method === "initialize") {
    return reply({
      protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "linear-ticket", version: "1.0.0" },
      instructions: "Every tool acts only on the Linear ticket this agent was launched from.",
    });
  }
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: tools.map(({ run, ...tool }) => tool) });
  if (method === "tools/call") {
    const tool = tools.find((t) => t.name === (params && params.name));
    if (!tool) return fail(-32602, "Unknown tool");
    try {
      const result = await tool.run((params && params.arguments) || {});
      return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (error) {
      return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : "The Linear request failed." }], isError: true });
    }
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return;
  fail(-32601, "Method not found");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  void handle(message).catch(() => {});
});
`;
