import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../shared/peer-creation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parsePeerCreation } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const agentId = "444b8f9e-ec02-443c-a35a-383750aa9fe3";
const result = { agentId, workspaceId: "wks_1309409ff4a731ce", projectName: "loyca-ai", provider: "codex", model: "gpt-5.6-sol", independent: true };
const call = {
  type: "tool_call",
  name: "peer-agents.create_peer_agent",
  status: "completed",
  detail: {
    type: "unknown",
    input: { projectId: "prj_36cb7e5fad1fd4be", title: "Peer inherited model test", prompt: "Review the change" },
    output: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: null },
  },
};

test("turns a completed create_peer_agent call into creation card data", () => {
  assert.deepEqual(parsePeerCreation(call), {
    status: "created",
    agentId,
    workspaceId: result.workspaceId,
    projectName: "loyca-ai",
    task: "Review the change",
    title: "Peer inherited model test",
  });
});

test("accepts structured results and alternate MCP tool naming", () => {
  const value = { ...call, name: "mcp__peer_agents__create_peer_agent", detail: {
    ...call.detail,
    type: "plain_text",
    input: JSON.stringify({ prompt: "Investigate the issue" }),
    output: { structuredContent: { ...result, projectName: undefined } },
  } };
  assert.deepEqual(parsePeerCreation(value), {
    status: "created",
    agentId,
    workspaceId: result.workspaceId,
    projectName: null,
    task: "Investigate the issue",
    title: null,
  });
});

test("shows a pending card until creation completes", () => {
  assert.deepEqual(parsePeerCreation({ ...call, status: "running", detail: { ...call.detail, output: undefined } }), {
    status: "creating",
    agentId: null,
    workspaceId: null,
    projectName: null,
    task: "Review the change",
    title: "Peer inherited model test",
  });
});

test("leaves failed, unrelated, and error calls in the normal timeline", () => {
  assert.equal(parsePeerCreation({ ...call, status: "failed" }), null);
  assert.equal(parsePeerCreation({ ...call, name: "other.create_peer_agent" }), null);
  assert.equal(parsePeerCreation({ ...call, detail: { ...call.detail, output: { isError: true, content: [] } } }), null);
});
