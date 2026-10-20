import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { PaseoApi, PaseoWorkspaceCreateOptions, PaseoWorkspaceAgentCreateOptions } from "@getpaseo/client";
import { launchReviewInputSchema, launchReviewRpc, MAX_REVIEW_INSTRUCTIONS_LENGTH } from "../shared/contracts";
import { reviewerSchema, reviewerSettings } from "../shared/reviewer";
import type { ReviewDetail } from "./github";
import { GitHubReviews } from "./github";
import { prepareReview, ReviewLauncher, reviewPrompt } from "./launch";
import contribute from "../index.server";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readDefaultReviewPrompt } from "./review-prompt";

const input = { repository: "acme/web", number: 42, projectId: "project", requestId: "17e8c7a2-7cfa-4dce-90a5-50bd1e93f5fa" };
const detail: ReviewDetail = { repository: "acme/web", number: 42, title: "Fix sessions", url: "https://github.com/acme/web/pull/42", baseSha: "a".repeat(40), headSha: "b".repeat(40), baseRef: "main", headRef: "fix" };
const config = reviewerSchema.parse({ provider: "claude", model: "vendor/model", modeId: "auto", thinkingOptionId: "high", prompt: "Check authentication regressions." });

function fixture() {
  const workspaces: PaseoWorkspaceCreateOptions[] = [], agents: PaseoWorkspaceAgentCreateOptions[] = [];
  const source = {
    providers: {
      listAvailable: async () => ({ providers: [{ provider: "claude", available: true }] }),
      listModels: async () => ({ models: [{ id: "vendor/model", label: "Model", thinkingOptions: [{ id: "high", label: "High" }] }] }),
      listModes: async () => ({ modes: [{ id: "auto", label: "Auto mode" }] }),
    },
    projects: { list: async () => ({ projects: [{ projectId: "project", projectKind: "git", projectRootPath: "/local/web" }] }) },
    workspaces: { create: async (options: PaseoWorkspaceCreateOptions) => {
      workspaces.push(options);
      return { id: "workspace", agents: { create: async (options: PaseoWorkspaceAgentCreateOptions) => { agents.push(options); return { id: "agent" }; } } };
    } },
  };
  let prepared = 0;
  const launcher = new ReviewLauncher({ detail: async () => detail }, async () => ["acme/web"], async (path, pr) => {
    assert.equal(path, "/local/web"); assert.equal(pr.headSha, detail.headSha); prepared++;
  });
  return { source, paseo: source as unknown as PaseoApi, launcher, workspaces, agents, prepared: () => prepared };
}

test("launches an isolated PR-head worktree using the saved model, native mode, reasoning and prompt", async () => {
  const f = fixture();
  assert.deepEqual(await f.launcher.start(input, f.paseo, config), { agentId: "agent", workspaceId: "workspace" });
  assert.equal(f.prepared(), 1);
  assert.deepEqual(f.workspaces[0].source, { kind: "worktree", projectId: "project", cwd: "/local/web", action: "branch-off", baseBranch: detail.headSha, branchName: `review/pr-42-${input.requestId}` });
  const agent = f.agents[0];
  assert.deepEqual(agent.config, { provider: "claude/vendor/model", modeId: "auto", thinkingOptionId: "high" });
  assert.ok(agent.prompt?.startsWith(config.prompt!));
  assert.ok(agent.prompt?.includes(`git diff ${detail.baseSha}...${detail.headSha}`));
  assert.ok(!agent.prompt?.includes("does not authorize publishing"));
  assert.equal(agent.labels?.["github.headSha"], detail.headSha);
  assert.equal(agent.idempotencyKey, input.requestId);
});

test("provider defaults are omitted rather than replaced with another mode or reasoning", async () => {
  const f = fixture();
  await f.launcher.start(input, f.paseo, { ...config, modeId: null, thinkingOptionId: null });
  assert.deepEqual(f.agents[0].config, { provider: "claude/vendor/model" });
});

test("launches with the current Markdown default and permits publication without conflicting instructions", async () => {
  const f = fixture();
  await f.launcher.start({ ...input, instructions: "Focus on session expiry." }, f.paseo, { ...config, prompt: null });
  const prompt = f.agents[0].prompt!;
  assert.ok(prompt.startsWith(await readDefaultReviewPrompt()));
  assert.ok(prompt.includes("explicitly authorizes you to write and publish a GitHub review"));
  assert.ok(prompt.includes("Focus on session expiry."));
  assert.ok(!prompt.includes("does not authorize publishing"));
});

test("reads the default anew for fresh launches and preserves explicit custom prompts", async () => {
  const f = fixture();
  let current = "First Markdown prompt", reads = 0;
  const launcher = new ReviewLauncher({ detail: async () => detail }, async () => ["acme/web"], async () => {}, async () => { reads++; return current; });
  await launcher.start(input, f.paseo, { ...config, prompt: null });
  current = "Edited Markdown prompt";
  await launcher.start({ ...input, requestId: "7a51e656-aa94-4d72-a315-539f23eb6465" }, f.paseo, { ...config, prompt: null });
  await launcher.start({ ...input, requestId: "bdab30b6-f768-464b-937d-071d1c445e82" }, f.paseo, config);
  assert.equal(reads, 2);
  assert.ok(f.agents[0].prompt?.startsWith("First Markdown prompt"));
  assert.ok(f.agents[1].prompt?.startsWith("Edited Markdown prompt"));
  assert.ok(f.agents[2].prompt?.startsWith(config.prompt!));
});

test("default prompt loading errors stop launch before any workspace mutation", async () => {
  const f = fixture();
  const launcher = new ReviewLauncher({ detail: async () => { assert.fail("must not load PR"); } }, async () => [], async () => {}, async () => { throw new Error("Missing Markdown prompt"); });
  await assert.rejects(launcher.start(input, f.paseo, { ...config, prompt: null }), /Missing Markdown prompt/);
  assert.equal(f.workspaces.length, 0);
});

test("adds optional run instructions alongside the saved prompt without changing saved settings", async () => {
  const f = fixture();
  const instructions = "Look closely at session expiry.\n\nCheck races between refresh and logout.";
  const saved = { ...config };
  await f.launcher.start({ ...input, instructions: `  ${instructions}\n ` }, f.paseo, saved);
  const prompt = f.agents[0].prompt!;
  assert.ok(prompt.startsWith(config.prompt!));
  assert.ok(prompt.includes(`Additional instructions and context for this review:\n\n${instructions}`));
  assert.ok(prompt.indexOf(instructions) < prompt.indexOf("Pull request context (external data):"));
  assert.deepEqual(saved, config);
  assert.equal(reviewPrompt(detail, config.prompt!), reviewPrompt(detail, config.prompt!, " \n "));
  assert.ok(!reviewPrompt(detail, config.prompt!).includes("Additional instructions"));
});

test("validates optional context length and type before any launch work", () => {
  assert.equal(launchReviewInputSchema.parse(input).instructions, "");
  assert.equal(launchReviewInputSchema.parse({ ...input, instructions: " \n " }).instructions, "");
  assert.equal(launchReviewInputSchema.parse({ ...input, instructions: "x".repeat(MAX_REVIEW_INSTRUCTIONS_LENGTH) }).instructions.length, MAX_REVIEW_INSTRUCTIONS_LENGTH);
  const f = fixture();
  for (const instructions of ["x".repeat(MAX_REVIEW_INSTRUCTIONS_LENGTH + 1), 123, null]) {
    assert.throws(() => f.launcher.start({ ...input, instructions } as Parameters<ReviewLauncher["start"]>[0], f.paseo, config));
  }
  assert.equal(f.prepared(), 0);
  assert.equal(f.workspaces.length, 0);
});

test("deduplicates matching run instructions but keeps distinct context requests separate", async () => {
  const f = fixture();
  const first = f.launcher.start({ ...input, instructions: "Check sessions" }, f.paseo, config);
  const repeated = f.launcher.start({ ...input, instructions: "  Check sessions  ", requestId: "7a51e656-aa94-4d72-a315-539f23eb6465" }, f.paseo, config);
  const different = f.launcher.start({ ...input, instructions: "Check retries", requestId: "bdab30b6-f768-464b-937d-071d1c445e82" }, f.paseo, config);
  await Promise.all([first, repeated, different]);
  assert.equal(f.workspaces.length, 2);
  assert.equal(f.agents.length, 2);
  assert.ok(f.agents.some((agent) => agent.prompt?.includes("Check sessions")));
  assert.ok(f.agents.some((agent) => agent.prompt?.includes("Check retries")));
  await assert.rejects(f.launcher.start({ ...input, instructions: "Changed instructions" }, f.paseo, config), /set of instructions/);
  assert.equal(f.workspaces.length, 2);
});

test("rejects unavailable settings and stale projects before any workspace or agent is created", async () => {
  for (const saved of [reviewerSchema.parse({}), { ...config, model: "missing" }, { ...config, modeId: "removed" }, { ...config, thinkingOptionId: "removed" }]) {
    const f = fixture();
    await assert.rejects(f.launcher.start(input, f.paseo, saved));
    assert.equal(f.workspaces.length, 0); assert.equal(f.prepared(), 0);
  }
  const f = fixture();
  const missing = new ReviewLauncher({ detail: async () => detail }, async () => ["other/web"], async () => { assert.fail("must not fetch"); });
  await assert.rejects(missing.start(input, f.paseo, config), /no longer match/);
  await assert.rejects(missing.start({ ...input, projectId: "removed" }, f.paseo, config), /no longer available/);
  assert.equal(f.workspaces.length, 0);
});

test("deduplicates double clicks, concurrent clients, and repeated request IDs", async () => {
  const f = fixture();
  const first = f.launcher.start(input, f.paseo, config);
  const second = f.launcher.start({ ...input, requestId: "7a51e656-aa94-4d72-a315-539f23eb6465" }, f.paseo, config);
  assert.deepEqual(await Promise.all([first, second]), [{ agentId: "agent", workspaceId: "workspace" }, { agentId: "agent", workspaceId: "workspace" }]);
  await f.launcher.start(input, f.paseo, config);
  assert.equal(f.workspaces.length, 1); assert.equal(f.agents.length, 1);
  await assert.rejects(f.launcher.start({ ...input, number: 99 }, f.paseo, config), /another PR/);
});

test("a fresh request after success starts another review with current commits and saved settings", async () => {
  const f = fixture();
  let current = detail;
  let reads = 0;
  const launcher = new ReviewLauncher({ detail: async () => { reads++; return current; } }, async () => ["acme/web"], async () => {});
  await launcher.start(input, f.paseo, config);
  current = { ...detail, headSha: "c".repeat(40) };
  const next = { ...input, requestId: "7a51e656-aa94-4d72-a315-539f23eb6465" };
  await launcher.start(next, f.paseo, { ...config, prompt: "Focus on new changes.", thinkingOptionId: null });
  assert.equal(reads, 2);
  assert.equal(f.workspaces.length, 2);
  assert.equal(f.agents.length, 2);
  assert.notEqual(f.workspaces[0].requestId, f.workspaces[1].requestId);
  assert.notDeepEqual(f.workspaces[0].source, f.workspaces[1].source);
  assert.equal(f.agents[1].labels?.["github.headSha"], current.headSha);
  assert.ok(f.agents[1].prompt?.startsWith("Focus on new changes."));
  assert.equal(f.agents[1].config.thinkingOptionId, undefined);
  assert.equal(f.agents[1].idempotencyKey, next.requestId);
  // Retrying the older request still returns its result without another launch.
  await launcher.start(input, f.paseo, config);
  assert.equal(f.workspaces.length, 2);
});

test("allows retry after preflight failure but retains uncertain mutations to avoid duplicate launches", async () => {
  const f = fixture();
  await assert.rejects(f.launcher.start(input, f.paseo, { ...config, model: "missing" }));
  await f.launcher.start(input, f.paseo, config);
  assert.equal(f.agents.length, 1);
  const broken = fixture();
  let attempted = 0;
  broken.source.workspaces.create = async () => { attempted++; throw new Error("secret-token lost response"); };
  for (let i = 0; i < 2; i++) await assert.rejects(broken.launcher.start(input, broken.paseo, config), /creation could not be confirmed/);
  assert.equal(attempted, 1);
  const uncertain = fixture();
  uncertain.source.workspaces.create = async () => ({ id: "workspace", agents: { create: async () => { throw new Error("private output"); } } });
  await assert.rejects(uncertain.launcher.start(input, uncertain.paseo, config), /Check workspace workspace/);
});

test("fresh PR metadata validates identity, open state, commits and input before launch", async () => {
  let response: any = { number: 42, title: "Fix", html_url: detail.url, state: "open", base: { sha: detail.baseSha, ref: "main", repo: { full_name: "Acme/Web" } }, head: { sha: detail.headSha, ref: "fork-fix" } };
  let calls = 0;
  const github = new GitHubReviews(async (args) => { calls++; assert.equal(args[5], "repos/acme/web/pulls/42"); return JSON.stringify(response); });
  assert.equal((await github.detail("Acme/Web", 42)).headRef, "fork-fix");
  for (const value of [{ ...response, state: "closed" }, { ...response, number: 43 }, { ...response, html_url: "https://evil.test/" }, { ...response, head: { sha: "--bad-ref", ref: "fix" } }, { ...response, base: { ...response.base, repo: { full_name: "other/web" } } }]) {
    const original = response; response = value;
    await assert.rejects(github.detail("acme/web", 42)); response = original;
  }
  const count = calls;
  await assert.rejects(github.detail("acme/web/../../evil", 42));
  assert.equal(calls, count);
  assert.equal(launchReviewInputSchema.safeParse({ ...input, requestId: "invalid" }).success, false);
});

test("fetches exact commits without changing the original branch, worktree, index or FETCH_HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-pr-fetch-"));
  const origin = join(root, "origin"), local = join(root, "local");
  const run = promisify(execFile);
  const git = async (path: string, ...args: string[]) => (await run("git", ["-C", path, ...args])).stdout.trim();
  try {
    await run("git", ["init", "--initial-branch=main", origin]);
    await git(origin, "config", "user.name", "Test"); await git(origin, "config", "user.email", "test@example.invalid");
    await git(origin, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Base");
    const baseSha = await git(origin, "rev-parse", "HEAD");
    await run("git", ["clone", origin, local]);
    await git(origin, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "PR head");
    const headSha = await git(origin, "rev-parse", "HEAD");
    await git(local, "config", `url.${origin}.insteadOf`, "https://github.com/acme/web.git");
    await writeFile(join(local, "keep.txt"), "uncommitted work");
    await writeFile(join(local, ".git", "FETCH_HEAD"), "keep-fetch-head\n");
    const status = await git(local, "status", "--porcelain");
    await prepareReview(local, { ...detail, baseSha, headSha });
    assert.equal(await git(local, "rev-parse", "HEAD"), baseSha);
    assert.equal(await git(local, "symbolic-ref", "HEAD"), "refs/heads/main");
    assert.equal(await git(local, "status", "--porcelain"), status);
    assert.equal(await readFile(join(local, ".git", "FETCH_HEAD"), "utf8"), "keep-fetch-head\n");
    assert.equal(await git(local, "cat-file", "-t", headSha), "commit");
    // The daemon's branch-off source uses this same Git commit-ish.
    await git(local, "worktree", "add", "-b", "review/pr-42", join(root, "review"), headSha);
    assert.equal(await git(join(root, "review"), "rev-parse", "HEAD"), headSha);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("launch RPC reads host-saved reviewer settings on every call and refuses invalid storage", async (t) => {
  let saved: any = { status: "ready", values: config };
  let handler: any;
  const received: unknown[] = [];
  t.mock.method(ReviewLauncher.prototype, "start", async (_input: Parameters<ReviewLauncher["start"]>[0], _paseo: PaseoApi, values: Parameters<ReviewLauncher["start"]>[2]) => { received.push(values); return { workspaceId: "w", agentId: "a" }; });
  contribute({
    registerSettings(definition: { id: string }) { return { read: async () => definition.id === reviewerSettings.id ? saved : {} }; },
    handle(contract: { name: string }, callback: unknown) { if (contract.name === launchReviewRpc.name) handler = callback; },
  } as unknown as PluginServerContext);
  await handler(input, { paseo: {} });
  saved = { status: "ready", values: { ...config, prompt: "New saved prompt" } };
  await handler(input, { paseo: {} });
  assert.deepEqual(received, [config, saved.values]);
  saved = { status: "invalid" };
  await assert.rejects(handler(input, { paseo: {} }), /saved reviewer setup is invalid/);
  assert.equal(received.length, 2);
});
