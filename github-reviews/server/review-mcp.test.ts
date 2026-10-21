import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReviewStore, runSchema } from "./review-store";
import { REVIEW_MCP_PATH, REVIEW_TSX_LOADER } from "./review-prompt-path.generated";

const head = "a".repeat(40), base = "b".repeat(40);
test("installed MCP and CLI entrypoints expose tools and publish only via the guarded gh handler", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "review-mcp-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const id = randomUUID(), store = new ReviewStore(home);
  await store.create(runSchema.parse({ version: 1, id, agentId: id, repository: "acme/web", number: 42, headSha: head, baseSha: base, status: "reviewing", reason: null, reviewUrl: null, updatedAt: new Date().toISOString(), reviewer: { id: 7, login: "reviewer" } }));
  // A fake executable verifies the real subprocess/JSON-stdin route without any network write.
  const mockGh = `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2), method = args[4], endpoint = args[5];
const root = process.env.REVIEW_TEST_HOME;
appendFileSync(root+'/gh-calls.jsonl',JSON.stringify(args)+'\\n');
let reviews = []; try { reviews = JSON.parse(readFileSync(root+'/gh-state.json', 'utf8')); } catch {}
let response;
if (endpoint === 'user') response = {id:7,login:'reviewer'};
else if (endpoint === 'repos/acme/web/pulls/42') response = {number:42,title:'Fix',state:'open',draft:false,html_url:'https://github.com/acme/web/pull/42',base:{sha:'${base}',ref:'main',repo:{full_name:'acme/web'}},head:{sha:'${head}',ref:'fix'}};
else if (endpoint.endsWith('/reviews') && method === 'POST') {
 const input=JSON.parse(readFileSync(0,'utf8'));
 appendFileSync(root+'/gh-posts.jsonl',JSON.stringify(input)+'\\n');
 response={id:100,html_url:'https://github.com/acme/web/pull/42#pullrequestreview-100',state:'COMMENTED',commit_id:input.commit_id,body:input.body,user:{id:7,login:'reviewer'}};
 reviews.push(response); writeFileSync(root+'/gh-state.json',JSON.stringify(reviews));
} else if (endpoint.endsWith('/reviews')) response=reviews;
else if (endpoint.endsWith('/comments')) response=[];
else throw new Error('Unexpected operation '+endpoint);
process.stdout.write(JSON.stringify(response));
`;
  await writeFile(join(home, "gh"), mockGh, { mode: 0o700 });
  await writeFile(join(home, "package.json"), '{"type":"module"}');
  function invoke(input: string, cli = false, runId = id) {
    return new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ["--import", REVIEW_TSX_LOADER, REVIEW_MCP_PATH, "--run", runId, "--home", home, ...(cli ? ["--submit"] : [])], {
        timeout: 10_000, env: { ...process.env, PATH: `${home}:${process.env.PATH}`, REVIEW_TEST_HOME: home },
      }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout));
      child.stdin!.end(input);
    });
  }
  const metadata = (await invoke([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", method: "tools/call", params: { name: "report_review_blocker", arguments: { reason: "Notification must not mutate state" } } },
  ].map((item) => JSON.stringify(item)).join("\n") + "\n")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(metadata[0].result.serverInfo.name, "github-review-publication");
  assert.deepEqual(metadata[1].result.tools.map((tool: { name: string }) => tool.name), ["get_review_status", "submit_review", "report_review_blocker"]);
  assert.equal((await store.read(id))!.status, "reviewing");
  const submit = { complete: true, conclusion: "clean" };
  const published = JSON.parse(await invoke(JSON.stringify(submit), true));
  assert.equal(published.status, "published");
  assert.equal(published.reviewUrl, "https://github.com/acme/web/pull/42#pullrequestreview-100");
  await invoke(JSON.stringify(submit), true);
  const posts = (await readFile(join(home, "gh-posts.jsonl"), "utf8")).trim().split("\n");
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0]).event, "COMMENT");
  assert.equal(JSON.parse(posts[0]).commit_id, head);

  const draftId = randomUUID();
  await store.create(runSchema.parse({ version: 1, id: draftId, agentId: draftId, repository: "acme/web", number: 42, headSha: head, baseSha: base,
    reviewOnly: true, status: "reviewing", reason: null, reviewUrl: null, updatedAt: new Date().toISOString(), reviewer: { id: 7, login: "reviewer" } }));
  const callsBeforeDraft = await readFile(join(home, "gh-calls.jsonl"), "utf8");
  const draftTools = JSON.parse((await invoke(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })}\n`, false, draftId)).trim());
  assert.match(draftTools.result.tools.find((tool: { name: string }) => tool.name === "submit_review").description, /locally/);
  const local = JSON.parse(await invoke(JSON.stringify(submit), true, draftId));
  assert.equal(local.status, "completed"); assert.equal(local.reviewUrl, null);
  assert.equal((await store.read(draftId))!.submission?.conclusion, "clean");
  await invoke(JSON.stringify(submit), true, draftId);
  assert.equal(await readFile(join(home, "gh-calls.jsonl"), "utf8"), callsBeforeDraft);
});
