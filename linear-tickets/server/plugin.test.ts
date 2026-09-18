import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server";
import type { PaseoApi, PaseoWorkspaceAgentCreateOptions, PaseoWorkspaceCreateOptions } from "@getpaseo/client";
import { buildContext, buildPrompt, issuePage, normalizeIssue, connection } from "./context";
import { Credentials } from "./credentials";
import { Launcher } from "./launch";
import { LinearService, postGraphQL, COMMENT_QUERY, ISSUE_DETAIL_QUERY, LIST_ISSUES_QUERY, VIEWER_QUERY, type Post } from "./linear";

// GraphQL-shaped fixture: workflow state, priority label, label connection,
// and the relationship fields the detail query requests.
const rawIssue = {
  id: "issue-1", identifier: "ENG-42", title: "Fix the sign-in flow",
  description: "Keep the existing session alive.", url: "https://linear.app/example/issue/ENG-42",
  state: { name: "In Progress" }, priorityLabel: "P1",
  project: { id: "project-1", name: "App", identifier: "APP", url: "https://linear.app/example/project/app" },
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  labels: { nodes: [{ id: "label-1", name: "bug" }] },
  createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-02T00:00:00.000Z",
  parent: null,
  children: { nodes: [{ id: "issue-3", identifier: "ENG-44", title: "Child task" }] },
  relations: { nodes: [{ type: "blocks", issue: null, relatedIssue: { id: "issue-2", identifier: "ENG-43", title: "Blocked work" } }] },
  attachments: { nodes: [{ id: "attachment-1", title: "screenshot.png", url: "https://files.example.com/screenshot.png" }] },
  documents: { nodes: [] },
};
const comment = {
  id: "comment-1", body: "Regression on mobile", createdAt: "2025-01-02T01:00:00.000Z",
  url: "https://linear.app/example/issue/ENG-42#comment-1", user: { name: "Tofu" },
};
const detail = { issue: normalizeIssue(rawIssue), context: buildContext(rawIssue, [comment]), warnings: [] };
const input = { id: "ENG-42", projectId: "project-1", provider: "test/model", instructions: "Add a regression check.", requestId: "5f6f1154-5838-4439-b981-b3c9d9831488" };

test("server entrypoint loads and registers valid Paseo RPC contracts", () => {
  const names: string[] = [];
  const cleanup = contribute({ handle(contract: { name: string }) { names.push(contract.name); } } as unknown as PluginServerContext);
  assert.deepEqual(names, ["linear.status", "linear.connect", "linear.disconnect", "linear.list-issues", "linear.issue-context", "linear.project-branches", "linear.launch-agent"]);
  cleanup();
});

function mockFetch(t: TestContext, makeResponse: () => Response): void {
  t.mock.method(globalThis, "fetch", ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(makeResponse())) as typeof fetch);
}

test("Linear API requests carry the key, exact query and variables, and never follow redirects", async (t) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify({ data: { viewer: { id: "user-1" } } }), { status: 200, headers: { "content-type": "application/json" } }));
  }) as typeof fetch);
  const data = await postGraphQL("secret-key", "query q { viewer { id } }", { a: 1 });
  assert.deepEqual(data, { viewer: { id: "user-1" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.linear.app/graphql");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  const headers = calls[0].init.headers as Record<string, string>;
  // Linear's GraphQL API takes the raw key; a Bearer prefix is rejected with HTTP 400.
  assert.equal(headers.authorization, "secret-key");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { query: "query q { viewer { id } }", variables: { a: 1 } });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("authentication, rate-limit and server failures map to user-actionable errors", async (t) => {
  const cases: Array<{ status: number; body: unknown; message: RegExp }> = [
    { status: 401, body: { errors: [{ message: "Authentication required" }] }, message: /rejected this API key. Authentication required/ },
    { status: 403, body: { errors: [{ message: "forbidden" }] }, message: /rejected this API key. forbidden/ },
    { status: 429, body: { errors: [{ message: "rate limited" }] }, message: /rate-limiting/ },
    { status: 400, body: { errors: [{ message: "Remove the Bearer prefix from the Authorization header." }] }, message: /request failed: Remove the Bearer prefix/ },
    { status: 500, body: { errors: [{ message: "boom" }] }, message: /request failed: boom/ },
    { status: 502, body: "gateway html", message: /HTTP 502/ },
  ];
  for (const { status, body, message } of cases) {
    mockFetch(t, () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    await assert.rejects(postGraphQL("key", "query q { viewer { id } }", {}), message);
  }
});

test("GraphQL error payloads fail visibly with the API message", async (t) => {
  mockFetch(t, () => new Response(JSON.stringify({ data: null, errors: [{ message: "Issue not found" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  await assert.rejects(postGraphQL("key", "query q { issue(id: \"x\") { id } }", {}), /Issue not found/);
});

test("invalid response bodies fail loudly", async (t) => {
  mockFetch(t, () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }));
  await assert.rejects(postGraphQL("key", "q", {}), /invalid response/);
  mockFetch(t, () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
  await assert.rejects(postGraphQL("key", "q", {}), /unexpected response/);
});

test("network failures surface as connection errors", async (t) => {
  t.mock.method(globalThis, "fetch", (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch);
  await assert.rejects(postGraphQL("key", "q", {}), /Could not reach/);
});

test("issue normalization reads workflow state, priority labels and label connections", () => {
  const issue = normalizeIssue(rawIssue);
  assert.equal(issue.identifier, "ENG-42");
  assert.equal(issue.status, "In Progress");
  assert.equal(issue.priority, "P1");
  assert.equal(issue.project, "App");
  assert.equal(issue.team, "Engineering");
  assert.deepEqual(issue.labels, ["bug"]);
  assert.equal(issue.description, rawIssue.description);
  assert.equal(issue.updatedAt, rawIssue.updatedAt);
  assert.throws(() => normalizeIssue({ title: "Missing ID" }), /without an ID/);
});

test("connections expose nodes, page cursors and missing-page detection", () => {
  assert.deepEqual(connection({ nodes: [rawIssue], pageInfo: { hasNextPage: true, endCursor: "next" } }).endCursor, "next");
  assert.equal(connection({ nodes: [], pageInfo: { hasNextPage: false, endCursor: "last" } }).hasNextPage, false);
  assert.deepEqual(connection({}).nodes, []);
});

test("issue pagination follows pageInfo cursors and rejects missing ones", () => {
  const page = issuePage({ nodes: [rawIssue], pageInfo: { hasNextPage: true, endCursor: "next" } });
  assert.equal(page.nextCursor, "next");
  assert.equal(page.issues[0].identifier, "ENG-42");
  assert.equal(issuePage({ nodes: [], pageInfo: { hasNextPage: false, endCursor: "last" } }).nextCursor, null);
  assert.throws(() => issuePage({ nodes: [], pageInfo: { hasNextPage: true } }), /cursor/);
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

type PostCall = { key: string; query: string; variables: Record<string, unknown> };

function mockLinear(post: Post, environmentKey = "test-key") {
  return new LinearService(new Credentials("/unused", environmentKey), post);
}

test("ticket listing requests the authenticated user's assignments and forwards the cursor", async () => {
  const calls: PostCall[] = [];
  const post: Post = async (key, query, variables) => {
    calls.push({ key, query, variables });
    return { issues: { nodes: [rawIssue], pageInfo: { hasNextPage: false, endCursor: null } } };
  };
  const service = mockLinear(post);
  assert.deepEqual((await service.issues()).nextCursor, null);
  const page = await service.issues("page-2");
  assert.equal(page.issues[0].identifier, "ENG-42");
  assert.equal(page.issues[0].status, "In Progress");
  assert.equal(page.issues[0].labels[0], "bug");
  assert.equal(page.nextCursor, null);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.key, "test-key");
    assert.equal(call.query, LIST_ISSUES_QUERY);
  }
  assert.deepEqual(calls[0].variables, { first: 50, after: null });
  assert.deepEqual(calls[1].variables, { first: 50, after: "page-2" });
});

test("details fetch relations and paginated comments using the resolved issue ID", async () => {
  const calls: PostCall[] = [];
  const post: Post = async (key, query, variables) => {
    calls.push({ key, query, variables });
    if (query === ISSUE_DETAIL_QUERY) return { issue: rawIssue };
    if (query === COMMENT_QUERY) {
      assert.equal(variables.id, "issue-1");
      assert.equal(variables.first, 50);
      return variables.after == null
        ? { issue: { comments: { nodes: [comment], pageInfo: { hasNextPage: true, endCursor: "c2" } } } }
        : { issue: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: "c3" } } } };
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  const result = await mockLinear(post).detail("ENG-42");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].query, ISSUE_DETAIL_QUERY);
  assert.deepEqual(calls[0].variables, { id: "ENG-42" });
  assert.equal(calls[1].query, COMMENT_QUERY);
  assert.deepEqual(calls[1].variables, { id: "issue-1", first: 50, after: null });
  assert.deepEqual(calls[2].variables, { id: "issue-1", first: 50, after: "c2" });
  assert.equal(JSON.parse(result.context).comments.length, 1);
  assert.equal(JSON.parse(result.context).comments[0].body, "Regression on mobile");
  assert.deepEqual(result.warnings, []);
});

test("comment failures produce an explicit warning while the ticket details remain", async () => {
  const post: Post = async (_key, query) => {
    if (query === ISSUE_DETAIL_QUERY) return { issue: rawIssue };
    throw new Error("Connection lost");
  };
  const result = await mockLinear(post).detail("ENG-42");
  assert.match(result.warnings[0], /Comments could not be loaded/);
  assert.deepEqual(JSON.parse(result.context).comments, []);
});

test("missing issues fail explicitly and unconnected access asks for a connection", async () => {
  const post: Post = async () => ({ issue: null });
  await assert.rejects(mockLinear(post).detail("ENG-99"), /did not return this issue/);
  await assert.rejects(mockLinear(post, "").issues(), /Connect Linear/);
});

test("authenticate confirms the viewer and saves the key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-linear-auth-"));
  const path = join(directory, "credentials.json");
  try {
    const calls: PostCall[] = [];
    const post: Post = async (key, query, variables) => {
      calls.push({ key, query, variables });
      return { viewer: { id: "user-1" } };
    };
    const service = new LinearService(new Credentials(path, ""), post);
    const status = await service.authenticate("fresh-key");
    assert.deepEqual(status, { connected: true, source: "saved" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, "fresh-key");
    assert.equal(calls[0].query, VIEWER_QUERY);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { apiKey: "fresh-key" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("authenticate rejects keys Linear cannot confirm", async () => {
  const post: Post = async () => ({ viewer: null });
  await assert.rejects(mockLinear(post).authenticate("bad-key"), /did not confirm this API key/);
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
