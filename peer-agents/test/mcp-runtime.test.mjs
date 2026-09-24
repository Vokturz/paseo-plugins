import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../server/mcp-runtime.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { peerMcpRuntime } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

async function fixture(t, agentId = "creator-123", stripMcpIdentity = false, behavior = {}) {
  const directory = await mkdtemp(join(tmpdir(), "paseo-peer-test-"));
  const logPath = join(directory, "calls.jsonl");
  const fakeCli = join(directory, "paseo");
  await writeFile(fakeCli, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PEER_TEST_LOG, JSON.stringify({ args, caller: process.env.PASEO_AGENT_ID ?? null }) + "\\n");
if (args[0] === "project" && args[1] === "ls") console.log(JSON.stringify([
  { projectId: "project-git", name: "Git project", kind: "git", path: "/registered/git-project" },
  { projectId: "project-dir", name: "Directory project", kind: "directory", path: "/registered/dir-project" }
]));
else if (args[0] === "workspace" && args[1] === "create") console.log(JSON.stringify({ workspaceId: "workspace-789", project: "Git project" }));
else if (args[0] === "run") {
  if (process.env.PEER_TEST_RUN_ERROR === "1") { console.error("Agent launch failed"); process.exit(1); }
  console.log(JSON.stringify({ agentId: "peer-456", status: "running" }));
}
else if (args[0] === "agent" && args[1] === "ls") {
  if (process.env.PEER_TEST_LIST_ERROR === "1") { console.error("Agent list unavailable"); process.exit(1); }
  console.log(JSON.stringify(process.env.PEER_TEST_EXISTING_AGENT === "1" ? [{ id: "peer-456" }] : []));
}
else if (args[0] === "workspace" && args[1] === "archive") {
  if (process.env.PEER_TEST_ARCHIVE_ERROR === "1") { console.error("Archive failed"); process.exit(1); }
  console.log(JSON.stringify({ workspaceId: args[2], status: "archived" }));
}
else if (args[0] === "agent" && args[1] === "inspect" && args[2] === "creator-123") console.log(JSON.stringify({ Id: "creator-123", Provider: "codex", Model: "gpt-6-sol" }));
else if (args[0] === "agent" && args[1] === "inspect") console.log(JSON.stringify({ Id: "peer-456", ParentAgentId: null }));
else if (args[0] === "send") console.log(JSON.stringify({ agentId: args[1], status: "sent" }));
else process.exit(1);
`);
  await chmod(fakeCli, 0o755);
  const runtimeCommand = `(${peerMcpRuntime.toString()})()`;
  const wrapperCommand = `const { spawn } = require("node:child_process");
const env = { ...process.env, PASEO_AGENT_ID: "", PASEO_PEER_AGENT_ID: "" };
const child = spawn(process.execPath, ["-e", process.argv[1]], { env, stdio: ["pipe", "pipe", "inherit"] });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.on("exit", () => process.exit());`;
  const child = spawn(process.execPath, stripMcpIdentity ? ["-e", wrapperCommand, runtimeCommand] : ["-e", runtimeCommand], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      PEER_TEST_LOG: logPath,
      PASEO_AGENT_ID: agentId,
      PEER_TEST_RUN_ERROR: behavior.runError ? "1" : "0",
      PEER_TEST_LIST_ERROR: behavior.listError ? "1" : "0",
      PEER_TEST_EXISTING_AGENT: behavior.existingAgent ? "1" : "0",
      PEER_TEST_ARCHIVE_ERROR: behavior.archiveError ? "1" : "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await rm(directory, { recursive: true, force: true });
  });

  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  return {
    request,
    async calls() {
      try {
        return (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
  };
}

test("lists projects and creates an independent agent in the selected project", async (t) => {
  const client = await fixture(t);
  const listed = await client.request("tools/list");
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["list_peer_projects", "create_peer_agent", "send_peer_message"]);

  const projects = await client.request("tools/call", { name: "list_peer_projects", arguments: {} });
  assert.equal(projects.result.isError, undefined);
  assert.deepEqual(JSON.parse(projects.result.content[0].text).map((project) => project.projectId), ["project-git", "project-dir"]);

  const result = await client.request("tools/call", {
    name: "create_peer_agent",
    arguments: { prompt: "Review the change", projectId: "project-git", title: "Review", isolation: "worktree", branchName: "review-change" },
  });
  assert.equal(result.result.isError, undefined);
  assert.deepEqual(JSON.parse(result.result.content[0].text), {
    agentId: "peer-456", creatorAgentId: "creator-123", projectId: "project-git", projectName: "Git project", workspaceId: "workspace-789", provider: "codex", model: "gpt-6-sol", independent: true,
  });

  const calls = await client.calls();
  assert.equal(calls.length, 6);
  assert.deepEqual(calls[0].args.slice(0, 2), ["project", "ls"]);
  assert.deepEqual(calls[2].args.slice(0, 3), ["agent", "inspect", "creator-123"]);
  assert.deepEqual(calls[3].args.slice(0, 2), ["workspace", "create"]);
  assert.equal(calls[3].args[calls[3].args.indexOf("--project") + 1], "project-git");
  assert.equal(calls[3].args[calls[3].args.indexOf("--path") + 1], "/registered/git-project");
  assert.ok(calls[3].args.includes("worktree"));
  assert.ok(calls[3].args.includes("review-change"));
  assert.equal(calls[4].caller, "");
  assert.deepEqual(calls[4].args.slice(0, 2), ["run", "--background"]);
  assert.equal(calls[4].args[calls[4].args.indexOf("--workspace") + 1], "workspace-789");
  assert.equal(calls[4].args[calls[4].args.indexOf("--provider") + 1], "codex");
  assert.equal(calls[4].args[calls[4].args.indexOf("--model") + 1], "gpt-6-sol");
  assert.ok(calls[4].args.includes("peer.workspace-id=workspace-789"));
  assert.ok(calls[4].args.some((arg) => arg.includes("Your peer agent ID is creator-123")));
  assert.deepEqual(calls[5].args.slice(0, 3), ["agent", "inspect", "peer-456"]);
});

test("archives an empty workspace after agent launch fails", async (t) => {
  const client = await fixture(t, "creator-123", false, { runError: true });
  const result = await client.request("tools/call", {
    name: "create_peer_agent", arguments: { prompt: "Review", projectId: "project-git" },
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /Workspace workspace-789 was archived/);
  const calls = await client.calls();
  assert.deepEqual(calls.at(-2).args.slice(0, 3), ["agent", "ls", "-g"]);
  assert.ok(calls.at(-2).args.includes("peer.workspace-id=workspace-789"));
  assert.deepEqual(calls.at(-1).args.slice(0, 3), ["workspace", "archive", "workspace-789"]);
});

test("keeps the workspace when a launch error may have hidden a created agent", async (t) => {
  const client = await fixture(t, "creator-123", false, { runError: true, existingAgent: true });
  const result = await client.request("tools/call", {
    name: "create_peer_agent", arguments: { prompt: "Review", projectId: "project-git" },
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /kept because an agent may have started/);
  const calls = await client.calls();
  assert.ok(!calls.some((call) => call.args[0] === "workspace" && call.args[1] === "archive"));
});

test("reports cleanup errors and preserves the workspace for inspection", async (t) => {
  const client = await fixture(t, "creator-123", false, { runError: true, archiveError: true });
  const result = await client.request("tools/call", {
    name: "create_peer_agent", arguments: { prompt: "Review", projectId: "project-git" },
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /cleanup check failed: Archive failed/);
});

test("does not archive when it cannot check whether the agent started", async (t) => {
  const client = await fixture(t, "creator-123", false, { runError: true, listError: true });
  const result = await client.request("tools/call", {
    name: "create_peer_agent", arguments: { prompt: "Review", projectId: "project-git" },
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /cleanup check failed: Agent list unavailable/);
  const calls = await client.calls();
  assert.ok(!calls.some((call) => call.args[0] === "workspace" && call.args[1] === "archive"));
});

test("uses an explicitly selected provider and model", async (t) => {
  const client = await fixture(t);
  const result = await client.request("tools/call", {
    name: "create_peer_agent",
    arguments: { prompt: "Review", projectId: "project-git", provider: "claude/sonnet" },
  });
  assert.equal(result.result.isError, undefined);
  assert.equal(JSON.parse(result.result.content[0].text).model, "sonnet");
  const calls = await client.calls();
  assert.equal(calls.length, 4);
  assert.ok(!calls.some((call) => call.args[0] === "agent" && call.args[2] === "creator-123"));
  const run = calls.find((call) => call.args[0] === "run");
  assert.equal(run.args[run.args.indexOf("--provider") + 1], "claude");
  assert.equal(run.args[run.args.indexOf("--model") + 1], "sonnet");
});

test("sends a cross-workspace message with the sender's ID", async (t) => {
  const client = await fixture(t);
  const result = await client.request("tools/call", {
    name: "send_peer_message",
    arguments: { agentId: "peer-456", message: "Please check the tests." },
  });
  assert.equal(result.result.isError, undefined);
  const calls = await client.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].caller, "creator-123");
  assert.deepEqual(calls[0].args.slice(0, 3), ["send", "peer-456", "--no-wait"]);
  assert.equal(calls[0].args[3], "Peer agent creator-123 says:\n\nPlease check the tests.");
});

test("gets the Paseo identity from the provider parent when the MCP environment is stripped", async (t) => {
  const client = await fixture(t, "parent-agent-789", true);
  const result = await client.request("tools/call", {
    name: "send_peer_message",
    arguments: { agentId: "peer-456", message: "Hello from loyca-ai!" },
  });
  assert.equal(result.result.isError, undefined);
  const calls = await client.calls();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.some((arg) => arg.includes("Peer agent parent-agent-789 says:")));
});

test("rejects an unknown project before launching an agent", async (t) => {
  const client = await fixture(t);
  const result = await client.request("tools/call", {
    name: "create_peer_agent",
    arguments: { prompt: "Review", projectId: "missing-project" },
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /Unknown Paseo project ID/);
  const calls = await client.calls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ["project", "ls"]);
});

test("rejects worktree isolation for a directory project", async (t) => {
  const client = await fixture(t);
  const result = await client.request("tools/call", {
    name: "create_peer_agent",
    arguments: { prompt: "Review", projectId: "project-dir", isolation: "worktree" },
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /does not support worktree isolation/);
  const calls = await client.calls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ["project", "ls"]);
});
