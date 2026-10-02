import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

function moduleUrl(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const runtime = moduleUrl(await readFile(new URL("../server/mcp-runtime.ts", import.meta.url), "utf8"));
const source = await readFile(new URL("../index.server.ts", import.meta.url), "utf8");
const { default: contribute } = await import(moduleUrl(source.replace('"./server/mcp-runtime"', JSON.stringify(runtime))));

test("injected MCP server starts with only its explicit environment", async () => {
  const hooks = new Map();
  contribute({ before(name, hook) { hooks.set(name, hook); } });
  const request = hooks.get("agent.create")({ request: { config: { provider: "codex" } } });
  const server = request.config.mcpServers["peer-agents"];
  // Codex filters the worker environment. Desktop's process.execPath is an
  // Electron binary and needs this flag in the MCP configuration itself.
  assert.equal(server.env.ELECTRON_RUN_AS_NODE, "1");
  const response = await new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args, { env: server.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `MCP exited with ${code}`));
      else {
        try { resolve(JSON.parse(stdout)); }
        catch (error) { reject(error); }
      }
    });
    child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  });
  assert.deepEqual(response.result.tools.map((tool) => tool.name), [
    "list_peer_projects", "create_peer_agent", "send_peer_message",
  ]);
});
