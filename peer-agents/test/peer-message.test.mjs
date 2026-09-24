import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../shared/peer-message.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parsePeerMessage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

async function loadShared(name) {
  const source = await readFile(new URL(`../shared/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("recognizes delivered peer prompts for the chat card", () => {
  const sender = "1388c1da-fdb3-46bc-9f0e-83a49ccf0ef7";
  assert.deepEqual(parsePeerMessage(`Peer agent ${sender} says:\n\nHello from loyca-ai!`), {
    fromAgentId: sender,
    message: "Hello from loyca-ai!",
  });
  assert.equal(parsePeerMessage("A normal user message"), null);
});

test("shows only the task from the first peer prompt", async () => {
  const { parsePeerTask } = await loadShared("peer-task");
  const creator = "ac3861ab-29f4-4dc3-af63-81e60f918fe5";
  const task = "Reply to the agent who created you by using mcp_peer_agents__send_peer_message. Send exactly: hi";
  const prompt = `Your peer agent ID is ${creator}. Use the send_peer_message tool to report progress, ask questions, and send your final result to that agent.\n\nTask:\n${task}`;
  assert.deepEqual(parsePeerTask(prompt), { creatorAgentId: creator, task });
  assert.equal(parsePeerTask("A normal user message"), null);
});

test("agent links use the host and agent route", async () => {
  const { peerAgentRoute, peerAgentAppLink } = await loadShared("agent-link");
  assert.equal(peerAgentRoute("local host", "agent/123"), "/h/local%20host/agent/agent%2F123");
  assert.equal(peerAgentAppLink("local host", "agent/123"), "paseo://h/local%20host/agent/agent%2F123");
});
