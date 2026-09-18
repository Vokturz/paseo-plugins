import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server";
import type { PaseoApi, PaseoWorkspaceAgentCreateOptions, PaseoWorkspaceCreateOptions } from "@getpaseo/client";
import { buildContext, buildPrompt, issuePage, normalizeIssue, toolData } from "./context";
import { Credentials } from "./credentials";
import { Launcher } from "./launch";
import { LinearService, type LinearSession } from "./linear";

const rawIssue = {
  id: "issue-1", identifier: "ENG-42", title: "Fix the sign-in flow",
  description: "Keep the existing session alive.", url: "https://linear.app/example/issue/ENG-42",
  status: { name: "In Progress" }, project: { name: "App" }, labels: ["bug"],
  relations: { blocks: [{ identifier: "ENG-43" }] },
};
const detail = { issue: normalizeIssue(rawIssue), context: buildContext(rawIssue, [{ body: "Regression on mobile" }]), warnings: [] };
const input = { id: "ENG-42", projectId: "project-1", provider: "test/model", instructions: "Add a regression check.", requestId: "5f6f1154-5838-4439-b981-b3c9d9831488" };

test("server entrypoint loads and registers valid Paseo RPC contracts", () => {
  const names: string[] = [];
  const cleanup = contribute({ handle(contract: { name: string }) { names.push(contract.name); } } as unknown as PluginServerContext);
  assert.deepEqual(names, ["linear.status", "linear.connect", "linear.disconnect", "linear.list-issues", "linear.issue-context", "linear.project-branches", "linear.launch-agent"]);
  cleanup();
});

test("tool responses accept structured content and JSON text, and reject malformed or error responses", () => {
  assert.deepEqual(toolData({ structuredContent: rawIssue }), rawIssue);
  assert.deepEqual(toolData({ content: [{ type: "text", text: JSON.stringify(rawIssue) }] }), rawIssue);
  assert.throws(() => toolData({ isError: true, content: [{ type: "text", text: "private upstream error" }] }), /could not complete/);
  assert.throws(() => toolData({ content: [{ type: "text", text: "not JSON" }] }), /cannot read/);
  assert.throws(() => normalizeIssue({ title: "Missing ID" }), /without an ID/);
});

test("pagination keeps cursors and normalizes nested fields without silently accepting missing pages", () => {
  const page = issuePage({ issues: [rawIssue], cursor: "next", hasNextPage: true });
  assert.equal(page.nextCursor, "next");
  assert.equal(page.issues[0].status, "In Progress");
  assert.equal(page.issues[0].project, "App");
  assert.equal(issuePage({ issues: [], nextCursor: "next" }).nextCursor, "next");
  assert.equal(issuePage({ issues: [], cursor: "last", hasNextPage: false }).nextCursor, null);
  assert.throws(() => issuePage({ issues: [], hasNextPage: true }), /cursor/);
  assert.throws(() => issuePage({}), /issue list/);
});

test("prompt preserves description, relationships, comments, user instructions and context warnings", () => {
  const prompt = buildPrompt({ ...detail, warnings: ["Some context unavailable"] }, input.instructions);
  assert.ok(prompt.includes(rawIssue.description));
  assert.ok(prompt.includes("ENG-43"));
  assert.ok(prompt.includes("Regression on mobile"));
  assert.ok(prompt.includes(input.instructions));
  assert.ok(prompt.includes("Some context unavailable"));
  assert.ok(prompt.includes("external task data"));
  assert.throws(() => buildContext({ description: "x".repeat(200_001) }, []), /too large/);
});

test("saved credentials stay on disk with private permissions and environment credentials take precedence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-linear-credentials-"));
  const path = join(directory, "connection", "credentials.json");
  try {
    const saved = new Credentials(path, "");
    assert.deepEqual(await saved.read(), { key: null, source: "none" });
    await saved.save("test-key");
    assert.deepEqual(await saved.read(), { key: "test-key", source: "saved" });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, "connection"))).mode & 0o777, 0o700);
    const environment = new Credentials(path, "environment-key");
    assert.deepEqual(await environment.read(), { key: "environment-key", source: "environment" });
    await assert.rejects(environment.save("replacement"), /LINEAR_API_KEY/);
    await assert.rejects(environment.remove(), /LINEAR_API_KEY/);
    await saved.remove();
    await assert.rejects(readFile(path), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function mockLinear(call: LinearSession["call"], tools = ["list_issues", "get_issue", "list_comments"]) {
  let closed = 0;
  const service = new LinearService(new Credentials("/unused", "test-key"), async (key) => {
    assert.equal(key, "test-key");
    return { tools: new Set(tools), call, close: async () => { closed++; } };
  });
  return { service, closed: () => closed };
}

test("ticket listing requests the authenticated user's assignments and forwards the cursor", async () => {
  const mock = mockLinear(async (name, args) => {
    assert.equal(name, "list_issues");
    assert.deepEqual(args, { assignee: "me", limit: 50, includeArchived: false, orderBy: "updatedAt", cursor: "page-2" });
    return { issues: [rawIssue], hasNextPage: false };
  });
  assert.equal((await mock.service.issues("page-2")).issues[0].identifier, "ENG-42");
  assert.equal(mock.closed(), 1);
});

test("details fetch relations and comments using the resolved issue ID, and close the connection", async () => {
  const calls: string[] = [];
  const mock = mockLinear(async (name, args) => {
    calls.push(name);
    if (name === "get_issue") { assert.deepEqual(args, { id: "ENG-42", includeRelations: true }); return rawIssue; }
    assert.deepEqual(args, { issueId: "issue-1" });
    return [{ body: "Fresh comment" }];
  });
  const result = await mock.service.detail("ENG-42");
  assert.deepEqual(calls, ["get_issue", "list_comments"]);
  assert.equal(JSON.parse(result.context).comments[0].body, "Fresh comment");
  assert.deepEqual(result.warnings, []);
  assert.equal(mock.closed(), 1);
});

test("unavailable comments produce an explicit warning while ticket failures close and reject", async () => {
  const missing = mockLinear(async () => rawIssue, ["get_issue", "list_issues"]);
  assert.match((await missing.service.detail("ENG-42")).warnings[0], /does not expose comments/);
  const failure = mockLinear(async () => { throw new Error("Connection lost"); });
  await assert.rejects(failure.service.detail("ENG-42"), /Connection lost/);
  assert.equal(failure.closed(), 1);
});

function mockPaseo(create: (options: PaseoWorkspaceAgentCreateOptions) => Promise<{ id: string }>, project: object | null = { projectId: "project-1", projectKind: "directory", projectRootPath: "/repo" }, onWorkspace?: (options: PaseoWorkspaceCreateOptions) => void) {
  return {
    projects: { list: async () => ({ projects: project ? [project] : [] }) },
    workspaces: { create: async (options: PaseoWorkspaceCreateOptions) => {
      onWorkspace?.(options);
      return { agents: { create } };
    } },
  } as unknown as PaseoApi;
}

test("launch fetches fresh context and starts exactly one agent for concurrent calls and response retries", async () => {
  let fetches = 0, creates = 0;
  const launcher = new Launcher({ detail: async () => { fetches++; return detail; } });
  const configured = { ...input, modeId: "code", thinkingOptionId: "high" };
  const paseo = mockPaseo(async (options) => {
    creates++;
    assert.deepEqual(options.config, { provider: input.provider, modeId: "code", thinkingOptionId: "high" });
    assert.equal(options.labels?.["linear.issueId"], "issue-1");
    assert.ok(options.prompt?.includes("Regression on mobile"));
    assert.ok(options.prompt?.includes(input.instructions));
    return { id: "agent-1" };
  });
  const alias = { ...configured, requestId: "3bca04b9-12a5-4764-8b11-98ad10c15c95" };
  const results = await Promise.all([launcher.start(configured, paseo), launcher.start(configured, paseo), launcher.start(alias, paseo)]);
  assert.ok(results.every((result) => result.agentId === "agent-1"));
  await launcher.start(configured, paseo);
  await launcher.start(alias, paseo);
  assert.equal(fetches, 1);
  assert.equal(creates, 1);
  await assert.rejects(launcher.start({ ...configured, id: "ENG-99" }, paseo), /already been used/);
});

test("pre-launch errors can retry, but uncertain agent creation is never automatically repeated", async () => {
  let fetches = 0, creates = 0;
  const launcher = new Launcher({ detail: async () => {
    if (++fetches === 1) throw new Error("Linear unavailable");
    return detail;
  } });
  const paseo = mockPaseo(async () => { creates++; throw new Error("Response lost after creation"); });
  await assert.rejects(launcher.start(input, paseo), /Linear unavailable/);
  await assert.rejects(launcher.start(input, paseo), /could not be confirmed/);
  await assert.rejects(launcher.start(input, paseo), /could not be confirmed/);
  assert.equal(fetches, 2);
  assert.equal(creates, 1);
});

test("a missing project cannot create an agent", async () => {
  const launcher = new Launcher({ detail: async () => { throw new Error("Should not fetch"); } });
  const paseo = mockPaseo(async () => { throw new Error("Should not create"); }, null);
  await assert.rejects(launcher.start(input, paseo), /project is no longer available/);
});


test("Git launches create a new ticket worktree from the chosen project and base branch", async () => {
  let workspaces = 0;
  const launcher = new Launcher({ detail: async () => detail }, async () => ({ branches: [{ id: "refs/remotes/origin/main", label: "origin/main" }], defaultBranch: null }));
  const paseo = mockPaseo(async () => ({ id: "agent-1" }), { projectId: "project-1", projectKind: "git", projectRootPath: "/repo" }, (options) => {
    workspaces++;
    assert.deepEqual(options.source, { kind: "worktree", projectId: "project-1", cwd: "/repo", action: "branch-off", baseBranch: "refs/remotes/origin/main", branchName: "eng-42-5f6f1154" });
    assert.equal(options.title, "ENG-42: Fix the sign-in flow");
  });
  const request = { ...input, baseBranch: "refs/remotes/origin/main" };
  await launcher.start(request, paseo);
  await launcher.start(request, paseo);
  assert.equal(workspaces, 1);
  await assert.rejects(launcher.start({ ...request, baseBranch: "refs/heads/other" }, paseo), /already been used/);
});

test("removed or missing base branches fail before creating a workspace", async () => {
  const launcher = new Launcher({ detail: async () => { throw new Error("Should not fetch"); } }, async () => ({ branches: [], defaultBranch: null }));
  const paseo = mockPaseo(async () => { throw new Error("Should not create"); }, { projectId: "project-1", projectKind: "git", projectRootPath: "/repo" }, () => { throw new Error("Should not create workspace"); });
  await assert.rejects(launcher.start({ ...input, baseBranch: "refs/heads/deleted" }, paseo), /available base branch/);
});

test("uncertain workspace creation is not repeated on request retry", async () => {
  let attempts = 0;
  const launcher = new Launcher({ detail: async () => detail });
  const paseo = mockPaseo(async () => { throw new Error("Should not create agent"); }, undefined, () => {
    attempts++;
    throw new Error("Response lost after workspace creation");
  });
  await assert.rejects(launcher.start(input, paseo), /Workspace creation could not be confirmed/);
  await assert.rejects(launcher.start(input, paseo), /Workspace creation could not be confirmed/);
  assert.equal(attempts, 1);
});
