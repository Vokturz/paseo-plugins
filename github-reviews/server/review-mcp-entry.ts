import { z } from "zod";
import { reviewOutcomeSchema, reviewSubmissionSchema } from "../shared/publication";
import { GitHubReviews } from "./github";
import { ReviewPublisher } from "./publication";
import { ReviewStore } from "./review-store";

const args = process.argv.slice(2);
function arg(key: string) { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : undefined; }
const runId = z.uuid().parse(arg("--run"));
const home = arg("--home");
if (!home) throw new Error("The review tool requires its Paseo home.");
const store = new ReviewStore(home);
const reviewOnly = (await store.read(runId))?.reviewOnly === true;
const publisher = new ReviewPublisher(new GitHubReviews(), store);
const tools = [
  { name: "get_review_status", description: "Read this review run's durable publication outcome.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "submit_review", description: reviewOnly ? "Save this review-only run's completed findings locally. Does not publish to GitHub." : "Publish this run's completed review through account, snapshot, duplicate and diff checks. At most one COMMENT review per run. Retry only the same content after uncertain submission.", inputSchema: z.toJSONSchema(reviewSubmissionSchema, { io: "input" }) },
  { name: "report_review_blocker", description: "Record why this review cannot be completed or published.", inputSchema: { type: "object", properties: { reason: { type: "string", minLength: 1, maxLength: 2_000 } }, required: ["reason"], additionalProperties: false } },
];
async function tool(name: string, input: unknown) {
  if (name === "submit_review") return publisher.submit(runId, input);
  const run = await store.read(runId);
  if (!run) throw new Error("This review run is unavailable.");
  if (name === "get_review_status") return run.uncertain && run.submission ? publisher.submit(runId, run.submission) : reviewOutcomeSchema.parse(run);
  if (name === "report_review_blocker") {
    const { reason } = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict().parse(input);
    return reviewOutcomeSchema.parse(await store.update(runId, (current) => ["published", "completed", "publishing"].includes(current.status) || current.uncertain ? current : { ...current, status: "blocked", reason }));
  }
  throw new Error("Unknown review tool.");
}
function send(value: unknown) { process.stdout.write(`${JSON.stringify(value)}\n`); }
let inFlight = false;
async function receive(line: string) {
  let message: { jsonrpc?: string; id?: string | number; method?: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } };
  try { message = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (!message || message.jsonrpc !== "2.0" || (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number")) return send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  if (message.id === undefined) return;
  const reply = (result: unknown) => send({ jsonrpc: "2.0", id: message.id, result });
  if (message.method === "initialize") return reply({ protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "github-review-publication", version: "1.0.0" } });
  if (message.method === "ping") return reply({});
  if (message.method === "tools/list") return reply({ tools });
  if (message.method !== "tools/call") return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  if (inFlight) return reply({ isError: true, content: [{ type: "text", text: "A review operation is already in progress. Retry after it finishes." }] });
  inFlight = true;
  try { reply({ content: [{ type: "text", text: JSON.stringify(await tool(message.params?.name ?? "", message.params?.arguments ?? {})) }] }); }
  catch (error) { reply({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The review operation failed." }] }); }
  finally { inFlight = false; }
}

let buffer = "", oversized = false;
process.stdin.setEncoding("utf8");
if (args.includes("--submit")) {
  process.stdin.on("data", (chunk: string) => { if (Buffer.byteLength(buffer) + Buffer.byteLength(chunk) > 1_048_576) oversized = true; else buffer += chunk; });
  process.stdin.on("end", () => { void (async () => { if (oversized) throw new Error("Review submission is too large."); send(await publisher.submit(runId, JSON.parse(buffer))); })().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Publication failed."}\n`); process.exitCode = 1; }); });
} else {
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (oversized) { oversized = false; continue; }
      if (Buffer.byteLength(line) > 1_048_576) { send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }); continue; }
      if (line.trim()) void receive(line);
    }
    if (Buffer.byteLength(buffer) > 1_048_576) { oversized = true; buffer = ""; }
  });
  process.stdin.on("end", () => { if (!oversized && buffer.trim()) void receive(buffer); });
}
