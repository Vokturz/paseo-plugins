import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import type { PaseoApi, PaseoWorkspaceAgentCreateOptions } from "@getpaseo/client";
import { LINEAR_ACCESS_NOTE, NO_LINEAR_ACCESS_NOTE } from "../shared/contracts";
import { buildPrompt, normalizeIssue } from "./context";
import { Launcher } from "./launch";
import { ticketMcpServer, writeTicketMcpScript } from "./ticket-mcp";

const ISSUE_ID = "6b1f0c2a-1111-4222-8333-444455556666";
const detail = { issue: normalizeIssue({ id: ISSUE_ID, identifier: "ENG-42", title: "Fix sign-in", url: "https://linear.app/x/issue/ENG-42" }), teamId: "team-1", projectId: "lp-1", context: "{}", warnings: [], relations: { parent: null, subissues: [], related: [] } };
const input = { id: ISSUE_ID, projectId: "project-1", provider: "test/model", instructions: "", markInProgress: false, requestId: "5f6f1154-5838-4439-b981-b3c9d9831488" };
const noMark = { markInProgress: async () => ({ changed: false }) };

function capturePaseo(onCreate: (options: PaseoWorkspaceAgentCreateOptions) => void) {
  return {
    projects: { list: async () => ({ projects: [{ projectId: "project-1", projectKind: "directory", projectRootPath: "/repo" }] }) },
    workspaces: { create: async () => ({ agents: { create: async (options: PaseoWorkspaceAgentCreateOptions) => { onCreate(options); return { id: "agent-1" }; } } }) },
  } as unknown as PaseoApi;
}

test("a launch with Linear access injects a ticket-scoped MCP server that carries no key", async () => {
  let options: PaseoWorkspaceAgentCreateOptions | undefined;
  const launcher = new Launcher({ ...noMark, detail: async () => detail }, undefined, async () => "/home/.paseo/linear-tickets/ticket-mcp-abc.mjs");
  await launcher.start(input, capturePaseo((value) => { options = value; }), { linearAccess: true });
  const servers = (options?.config as { mcpServers?: Record<string, { type: string; command: string; args: string[] }> }).mcpServers;
  assert.deepEqual(Object.keys(servers ?? {}), ["linear_ticket"]);
  const server = servers!.linear_ticket;
  assert.equal(server.type, "stdio");
  assert.equal(server.command, "node");
  assert.deepEqual(server.args.slice(0, 3), ["/home/.paseo/linear-tickets/ticket-mcp-abc.mjs", "--issue", ISSUE_ID]);
  assert.ok(!JSON.stringify(options).match(/lin_api|apiKey|LINEAR_API_KEY/));
  assert.ok(options?.prompt?.includes(LINEAR_ACCESS_NOTE));
  assert.ok(!options?.prompt?.includes(NO_LINEAR_ACCESS_NOTE));
});

test("a launch without Linear access adds no MCP server and keeps the no-write instruction", async () => {
  let options: PaseoWorkspaceAgentCreateOptions | undefined;
  const launcher = new Launcher({ ...noMark, detail: async () => detail }, undefined, async () => { throw new Error("Should not write the script"); });
  await launcher.start(input, capturePaseo((value) => { options = value; }), { linearAccess: false });
  assert.equal((options?.config as { mcpServers?: unknown }).mcpServers, undefined);
  assert.ok(options?.prompt?.includes(NO_LINEAR_ACCESS_NOTE));
});

test("a script write failure fails the launch before any workspace is created", async () => {
  let created = false;
  const launcher = new Launcher({ ...noMark, detail: async () => detail }, undefined, async () => { throw new Error("disk full"); });
  await assert.rejects(launcher.start(input, capturePaseo(() => { created = true; }), { linearAccess: true }), /disk full/);
  assert.equal(created, false);
});

test("custom templates get the access note appended unless they place it themselves", () => {
  const appended = buildPrompt(detail, "", "Do {{ticket}}\n{{context}}", true);
  assert.ok(appended.endsWith(LINEAR_ACCESS_NOTE));
  const placed = buildPrompt(detail, "", "{{linear_access}}\nDo {{ticket}}\n{{context}}", true);
  assert.ok(placed.startsWith(LINEAR_ACCESS_NOTE));
  assert.equal(placed.split(LINEAR_ACCESS_NOTE).length, 2);
  assert.ok(!buildPrompt(detail, "", "Do {{ticket}}\n{{context}}", false).includes("linear_ticket"));
  assert.ok(buildPrompt(detail, "", "{{linear_access}}\n{{context}}", false).startsWith(NO_LINEAR_ACCESS_NOTE));
});

test("the MCP script is written once, privately, under a content hash", async () => {
  const home = await mkdtemp(join(tmpdir(), "paseo-linear-mcp-write-"));
  try {
    const first = await writeTicketMcpScript(home);
    const second = await writeTicketMcpScript(home);
    assert.equal(first, second);
    assert.match(first, /ticket-mcp-[0-9a-f]{12}\.mjs$/);
    assert.equal((await stat(first)).mode & 0o777, 0o600);
    const other = await writeTicketMcpScript(home, "console.log(1)\n");
    assert.notEqual(other, first);
    assert.equal(await readFile(other, "utf8"), "console.log(1)\n");
  } finally { await rm(home, { recursive: true, force: true }); }
});

type Call = { authorization: string | undefined; query: string; variables: Record<string, unknown> };
async function fakeLinear(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const server = createServer(async (request: IncomingMessage, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    const call = { authorization: request.headers.authorization, query: parsed.query, variables: parsed.variables };
    calls.push(call);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: respond(call) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
  return { url, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function runServer(script: string, args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [script, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  });
  let next = 1;
  const request = (method: string, params?: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
    pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await request("tools/call", { name, arguments: args })).result as { content: { text: string }[]; isError?: boolean };
    return { text: result.content[0].text, isError: result.isError === true };
  };
  return { child, request, call, stop: () => { child.kill(); } };
}

const states = [
  { id: "s-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "s-progress", name: "In Progress", type: "started", position: 2 },
  { id: "s-review", name: "In Review", type: "started", position: 3 },
  { id: "s-canceled", name: "Canceled", type: "canceled", position: 4 },
];
const issue = { id: ISSUE_ID, identifier: "ENG-42", title: "Fix sign-in", url: "https://linear.app/x/issue/ENG-42", description: "desc", priorityLabel: "High", state: { name: "In Progress", type: "started" }, assignee: { name: "Teo" }, team: { id: "team-1", name: "Eng", states: { nodes: states } }, comments: { nodes: [{ body: "hi", createdAt: "2026-09-24T00:00:00Z", user: { name: "Teo" } }] }, attachments: { nodes: [] } };

test("the MCP server reads, comments, moves and links only its own ticket over stdio", async () => {
  const home = await mkdtemp(join(tmpdir(), "paseo-linear-mcp-e2e-"));
  const linear = await fakeLinear((call) => {
    if (call.query.includes("query ticket")) return { issue };
    if (call.query.includes("commentCreate")) return { commentCreate: { success: true, comment: { url: "https://linear.app/c/1" } } };
    if (call.query.includes("issueUpdate")) return { issueUpdate: { success: true, issue: { state: { name: "In Review" } } } };
    if (call.query.includes("attachmentLinkURL")) return { attachmentLinkURL: { success: true } };
    return {};
  });
  await mkdir(join(home, "linear-tickets"), { recursive: true });
  await writeFile(join(home, "linear-tickets", "credentials.json"), JSON.stringify({ apiKey: "saved-key" }));
  const script = await writeTicketMcpScript(home);
  const server = ticketMcpServer(script, ISSUE_ID, home);
  const mcp = runServer(server.args[0], server.args.slice(1), { LINEAR_TICKET_MCP_ENDPOINT: linear.url });
  try {
    const init = (await mcp.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).result as { protocolVersion: string };
    assert.equal(init.protocolVersion, "2025-06-18");
    const list = (await mcp.request("tools/list")).result as { tools: { name: string }[] };
    assert.deepEqual(list.tools.map((tool) => tool.name), ["get_ticket", "add_comment", "set_status", "link_url"]);

    const ticket = JSON.parse((await mcp.call("get_ticket")).text);
    assert.equal(ticket.identifier, "ENG-42");
    assert.deepEqual(ticket.availableStatuses.map((s: { name: string }) => s.name), ["Todo", "In Progress", "In Review"]);

    assert.equal((await mcp.call("add_comment", { body: "Started." })).isError, false);
    const comment = linear.calls.find((c) => c.query.includes("commentCreate"))!;
    assert.deepEqual(comment.variables, { input: { issueId: ISSUE_ID, body: "Started." } });
    assert.equal(comment.authorization, "saved-key");

    assert.match((await mcp.call("set_status", { status: "Shipped" })).text, /Unknown status.*In Review/);
    assert.match((await mcp.call("set_status", { status: "canceled" })).text, /Only a person/);
    assert.equal((await mcp.call("set_status", { status: "in progress" })).text.includes("\"changed\": false"), true);
    const moved = await mcp.call("set_status", { status: "in review" });
    assert.equal(moved.isError, false);
    assert.deepEqual(linear.calls.filter((c) => c.query.includes("issueUpdate")).map((c) => c.variables), [{ id: ISSUE_ID, stateId: "s-review" }]);

    assert.equal((await mcp.call("link_url", { url: "http://example.com/pr/1" })).isError, true);
    assert.equal((await mcp.call("link_url", { url: "https://github.com/o/r/pull/1", title: "PR" })).isError, false);
    assert.deepEqual(linear.calls.find((c) => c.query.includes("attachmentLinkURL"))!.variables, { issueId: ISSUE_ID, url: "https://github.com/o/r/pull/1", title: "PR" });

    assert.equal(((await mcp.request("tools/call", { name: "delete_everything" })).error as { code: number }).code, -32602);
    assert.equal(((await mcp.request("resources/list")).error as { code: number }).code, -32601);
    assert.ok(linear.calls.every((c) => !JSON.stringify(c.variables).includes("saved-key")));
  } finally { mcp.stop(); await linear.close(); await rm(home, { recursive: true, force: true }); }
});

test("the MCP server prefers LINEAR_API_KEY, reports a missing key, and ignores non-loopback endpoint overrides", async () => {
  const home = await mkdtemp(join(tmpdir(), "paseo-linear-mcp-key-"));
  const linear = await fakeLinear(() => ({ issue }));
  const script = await writeTicketMcpScript(home);
  const withEnv = runServer(script, ["--issue", ISSUE_ID, "--paseo-home", home], { LINEAR_TICKET_MCP_ENDPOINT: linear.url, LINEAR_API_KEY: "env-key" });
  const without = runServer(script, ["--issue", ISSUE_ID, "--paseo-home", home], { LINEAR_TICKET_MCP_ENDPOINT: linear.url });
  try {
    assert.equal((await withEnv.call("get_ticket")).isError, false);
    assert.equal(linear.calls[0].authorization, "env-key");
    const missing = await without.call("get_ticket");
    assert.equal(missing.isError, true);
    assert.match(missing.text, /not connected/);
    assert.equal(linear.calls.length, 1);
  } finally { withEnv.stop(); without.stop(); await linear.close(); await rm(home, { recursive: true, force: true }); }
});

test("the MCP server refuses to start without a valid issue id", async () => {
  const home = await mkdtemp(join(tmpdir(), "paseo-linear-mcp-args-"));
  try {
    const script = await writeTicketMcpScript(home);
    const code = await new Promise<number | null>((resolve) => {
      spawn(process.execPath, [script, "--issue", "../../etc", "--paseo-home", home], { stdio: "ignore" }).on("exit", resolve);
    });
    assert.equal(code, 2);
  } finally { await rm(home, { recursive: true, force: true }); }
});
