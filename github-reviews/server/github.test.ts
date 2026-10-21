import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server";
import { defaultReviewPromptRpc, reviewOutcomesRpc, launchReviewRpc, listInputSchema, listOwnersRpc, listReviewsRpc, MAX_PAGE, PAGE_SIZE, type PullRequestScope } from "../shared/contracts";
import { commandError, GitHubReviews, type RunGh } from "./github";
import { filterSettings, filtersSchema } from "../shared/filters";
import { reviewerSettings } from "../shared/reviewer";

function pullRequest(number = 42) {
  return {
    id: number + 1000, number, title: "Keep the session alive",
    html_url: `https://github.com/acme/web/pull/${number}`, state: "open",
    user: { login: "author" }, updated_at: "2026-10-20T10:00:00Z",
    labels: [{ name: "bug" }, "frontend"], draft: false,
    pull_request: { url: `https://api.github.com/repos/acme/web/pulls/${number}` },
    body: "Private PR description should not be sent to the client.",
  };
}

function runner(result: unknown, login = "reviewer") {
  const calls: string[][] = [];
  const run: RunGh = async (args) => {
    calls.push(args);
    return JSON.stringify(args.includes("user") ? { login, token: "never-return-this" } : result);
  };
  return { run, calls };
}

test("lists requested and already reviewed open PRs together with read-only GitHub API calls", async () => {
  const { run, calls } = runner({ total_count: 1, incomplete_results: false, items: [pullRequest()] });
  const before = Date.now();
  const result = await new GitHubReviews(run).list();
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.slice(0, 6), ["api", "--hostname", "github.com", "--method", "GET", call[5]]);
    assert.ok(call.includes("Accept: application/vnd.github+json"));
  }
  assert.equal(calls[0][5], "user");
  assert.equal(calls[1][5], "search/issues");
  assert.ok(calls[1].includes("q=is:pr is:open (review-requested:reviewer OR reviewed-by:reviewer)"));
  assert.ok(calls[1].includes("advanced_search=true"));
  assert.ok(calls[1].includes("sort=updated"));
  assert.ok(calls[1].includes("order=desc"));
  assert.ok(calls[1].includes("per_page=50"));
  assert.ok(calls[1].includes("page=1"));
  assert.deepEqual(result.pullRequests, [{
    id: 1042, number: 42, title: "Keep the session alive", repository: "acme/web",
    url: "https://github.com/acme/web/pull/42", author: "author",
    updatedAt: "2026-10-20T10:00:00Z", labels: ["bug", "frontend"], draft: false,
  }]);
  assert.equal(result.login, "reviewer");
  assert.equal(result.scope, "review-requested");
  assert.equal(result.totalCount, 1);
  assert.equal(result.nextPage, null);
  assert.equal(result.incomplete, false);
  assert.equal(result.capped, false);
  assert.ok(new Date(result.fetchedAt).getTime() >= before);
  assert.ok(!JSON.stringify(result).includes("never-return-this"));
  assert.ok(!JSON.stringify(result).includes("Private PR"));
});

test("created scope searches the signed-in author's open PRs without requiring a review request", async () => {
  const { run, calls } = runner({ total_count: 1, incomplete_results: false, items: [{ ...pullRequest(), user: { login: "my-account" }, draft: true }] }, "my-account");
  const result = await new GitHubReviews(run).list({ scope: "created" });
  assert.ok(calls[1].includes("q=is:pr is:open author:my-account"));
  assert.ok(!calls[1].some((arg) => arg.includes("review-requested:") || arg.includes("reviewed-by:")));
  assert.ok(!calls[1].includes("advanced_search=true"));
  assert.ok(calls[1].includes("sort=updated"));
  assert.ok(calls[1].includes("order=desc"));
  assert.equal(result.scope, "created");
  assert.equal(result.login, "my-account");
  assert.equal(result.totalCount, 1);
  assert.equal(result.pullRequests[0].author, "my-account");
  assert.equal(result.pullRequests[0].draft, true);
});

test("pagination advances full pages and stops at the result count or search cap", async () => {
  const items = Array.from({ length: PAGE_SIZE }, (_, index) => pullRequest(index + 1));
  const cases = [
    { total: 51, page: 1, next: 2, capped: false },
    { total: 50, page: 1, next: null, capped: false },
    { total: 100, page: 2, next: null, capped: false },
    { total: 1001, page: MAX_PAGE, next: null, capped: true },
  ];
  for (const entry of cases) {
    for (const scope of ["review-requested", "created"] as const) {
      const { run, calls } = runner({ total_count: entry.total, incomplete_results: false, items });
      const result = await new GitHubReviews(run).list({ page: entry.page, scope });
      assert.equal(result.scope, scope);
      assert.equal(result.nextPage, entry.next);
      assert.equal(result.capped, entry.capped);
      assert.ok(calls[1].includes(`page=${entry.page}`));
    }
  }
});

test("empty and partial results are represented without inventing more pages", async () => {
  for (const incomplete of [false, true]) {
    const { run } = runner({ total_count: incomplete ? 5 : 0, incomplete_results: incomplete, items: [] });
    const result = await new GitHubReviews(run).list();
    assert.deepEqual(result.pullRequests, []);
    assert.equal(result.nextPage, null);
    assert.equal(result.incomplete, incomplete);
  }
});

test("supports deleted authors, missing draft status and repositories containing dots", async () => {
  const { draft, ...pr } = pullRequest();
  const { run } = runner({ total_count: 1, incomplete_results: false, items: [{
    ...pr, user: null, labels: [], html_url: "https://github.com/acme/web.app/pull/42",
  }] });
  const result = await new GitHubReviews(run).list();
  assert.equal(result.pullRequests[0].author, null);
  assert.equal(result.pullRequests[0].draft, false);
  assert.equal(result.pullRequests[0].repository, "acme/web.app");
});

test("re-resolves the authenticated account for each refresh", async () => {
  let login = "first-account";
  const queries: string[] = [];
  const service = new GitHubReviews(async (args) => {
    if (args.includes("user")) return JSON.stringify({ login });
    queries.push(args.find((arg) => arg.startsWith("q="))!);
    return JSON.stringify({ total_count: 0, incomplete_results: false, items: [] });
  });
  assert.equal((await service.list()).login, "first-account");
  login = "second-account";
  assert.equal((await service.list()).login, "second-account");
  assert.deepEqual(queries, ["q=is:pr is:open (review-requested:first-account OR reviewed-by:first-account)", "q=is:pr is:open (review-requested:second-account OR reviewed-by:second-account)"]);
});

test("rejects invalid pages before running any command", async () => {
  for (const page of [0, -1, 1.5, MAX_PAGE + 1, NaN]) {
    const { run, calls } = runner({});
    await assert.rejects(new GitHubReviews(run).list({ page }));
    assert.equal(calls.length, 0);
    assert.equal(listInputSchema.safeParse({ page }).success, false);
  }
  assert.deepEqual(listInputSchema.parse({}), { page: 1, scope: "review-requested" });
});

test("rejects unsupported scopes before running a command", async () => {
  const { run, calls } = runner({});
  await assert.rejects(new GitHubReviews(run).list({ scope: "all author:someone-else" as PullRequestScope }));
  assert.equal(calls.length, 0);
});

test("invalid JSON, account data and search responses fail visibly", async () => {
  await assert.rejects(new GitHubReviews(async () => "not JSON").list(), /invalid response/);
  await assert.rejects(new GitHubReviews(async () => JSON.stringify({ login: "bad query:injection" })).list(), /valid signed-in account/);
  for (const response of [null, {}, { total_count: 1, items: [] }, { total_count: 1, incomplete_results: false, items: [{}] }]) {
    await assert.rejects(new GitHubReviews(runner(response).run).list(), /unexpected pull request response/);
  }
});

test("rejects non-PR and unsafe URLs returned as search items", async () => {
  for (const url of ["javascript:alert(1)", "https://github.com.evil.test/acme/web/pull/42", "https://github.com/acme/web/issues/42"]) {
    const { run } = runner({ total_count: 1, incomplete_results: false, items: [{ ...pullRequest(), html_url: url }] });
    await assert.rejects(new GitHubReviews(run).list(), /unexpected pull request response/);
  }
  const pr = pullRequest();
  const { pull_request, ...issue } = pr;
  await assert.rejects(new GitHubReviews(runner({ total_count: 1, incomplete_results: false, items: [issue] }).run).list(), /unexpected pull request response/);
});

test("command errors are actionable and never echo stderr or credentials", () => {
  const cases = [
    { failure: { code: "ENOENT" }, expected: /Install GitHub CLI/ },
    { failure: { killed: true }, expected: /too long/ },
    { failure: { stderr: "HTTP 401" }, expected: /gh auth login/ },
    { failure: { stderr: "To get started with GitHub CLI, please run: gh auth login" }, expected: /gh auth login/ },
    { failure: { stderr: "HTTP 403 rate limit exceeded" }, expected: /rate-limiting/ },
    { failure: { stderr: "HTTP 429" }, expected: /rate-limiting/ },
    { failure: { stderr: "HTTP 403" }, expected: /denied access/ },
    { failure: { stderr: "HTTP 422" }, expected: /could not search/ },
    { failure: { stderr: "HTTP 502" }, expected: /Could not reach/ },
  ];
  for (const { failure, expected } of cases) {
    const error = commandError({ ...failure, stderr: `${failure.stderr ?? ""} secret-token-123` });
    assert.match(error.message, expected);
    assert.ok(!error.message.includes("secret-token-123"));
  }
});

test("registers the list and owner RPCs with the Paseo server", () => {
  const contracts: unknown[] = [];
  const settings: unknown[] = [];
  const cleanup = contribute({
    on() { return () => {}; },
    registerSettings(definition: unknown) { settings.push(definition); return { read: async () => ({ status: "ready", values: filtersSchema.parse({}) }) }; },
    handle(contract: unknown) { contracts.push(contract); },
  } as unknown as PluginServerContext);
  assert.deepEqual(contracts, [launchReviewRpc, listReviewsRpc, listOwnersRpc, defaultReviewPromptRpc, reviewOutcomesRpc]);
  assert.deepEqual(settings, [filterSettings, reviewerSettings]);
  cleanup();
});

test("discovers users and organizations from accessible repositories, with pagination and no private repo data", async () => {
  const calls: string[][] = [];
  const service = new GitHubReviews(async (args) => {
    calls.push(args);
    return JSON.stringify(args.includes("user") ? { login: "My-Account" } : [
      { owner: { login: "ACME", type: "Organization" }, name: "secret-repo" },
      { owner: { login: "octocat", type: "User" } }, { owner: { login: "acme", type: "Organization" } },
    ]);
  });
  const result = await service.owners();
  assert.equal(calls[1][5], "user/repos");
  assert.ok(calls[1].includes("per_page=100"));
  assert.ok(calls[1].includes("page=1"));
  assert.ok(calls[1].includes("sort=full_name"));
  assert.equal(result.login, "my-account");
  assert.deepEqual(result.owners, [{ login: "acme", kind: "organization" }, { login: "my-account", kind: "user" }, { login: "octocat", kind: "user" }]);
  assert.equal(result.nextPage, null);
  assert.ok(!JSON.stringify(result).includes("secret-repo"));
});

test("owner discovery advances full pages and rejects invalid inputs or responses", async () => {
  const calls: string[][] = [];
  let repositories: unknown = Array.from({ length: 100 }, () => ({ owner: { login: "acme", type: "Organization" } }));
  const service = new GitHubReviews(async (args) => {
    calls.push(args);
    return JSON.stringify(args.includes("user") ? { login: "me" } : repositories);
  });
  assert.equal((await service.owners({ page: 2 })).nextPage, 3);
  assert.ok(calls[1].includes("page=2"));
  repositories = [];
  assert.deepEqual((await service.owners({ page: 3 })).owners, [{ login: "me", kind: "user" }]);
  repositories = [{ owner: { login: "bad query:injection", type: "Organization" } }];
  await assert.rejects(service.owners(), /unexpected repository owner response/);
  const before = calls.length;
  await assert.rejects(service.owners({ page: 0 }));
  assert.equal(calls.length, before);
});

test("batches current PR heads and preserves partial freshness failures", async () => {
  const bodies: { query: string }[] = [];
  const service = new GitHubReviews(async (args, input) => {
    assert.equal(args[4], "POST"); assert.equal(args[5], "graphql");
    assert.deepEqual(args.slice(-2), ["--input", "-"]);
    const body = JSON.parse(input!); bodies.push(body);
    const count = [...body.query.matchAll(/p\d+: repository/g)].length;
    return JSON.stringify({ data: Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, index === 1 ? null : { pullRequest: { headRefOid: "a".repeat(40) } }])) });
  });
  const targets = Array.from({ length: 27 }, (_, index) => ({ repository: "acme/web", number: index + 1 }));
  const result = await service.heads([...targets, targets[0]]);
  assert.equal(bodies.length, 2);
  assert.equal(Object.keys(result.heads).length, 27);
  assert.equal(result.heads["acme/web#1"], "a".repeat(40));
  assert.equal(result.heads["acme/web#2"], null);
  assert.match(result.warning!, /unavailable/);
  const unavailable = await new GitHubReviews(async () => { throw new Error("No access"); }).heads([targets[0]]);
  assert.equal(unavailable.heads["acme/web#1"], null);
  assert.ok(unavailable.warning);
});

test("paginates review history completely and passes publication JSON on stdin", async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const review = { id: 1, html_url: "https://github.com/acme/web/pull/42#pullrequestreview-1", state: "COMMENTED", body: "Review", commit_id: "a".repeat(40), user: { id: 7, login: "reviewer" } };
  const service = new GitHubReviews(async (args, input) => {
    calls.push({ args, input });
    if (input) return JSON.stringify(review);
    return JSON.stringify(args.includes("page=1") ? Array.from({ length: 100 }, (_, index) => ({ ...review, id: index + 1 })) : [review]);
  });
  assert.equal((await service.reviews("acme/web", 42)).length, 101);
  assert.ok(calls[1].args.includes("page=2"));
  const body = { commit_id: review.commit_id, event: "COMMENT", body: "Literal `$(private)` text\nsecond line" };
  await service.postReview("acme/web", 42, body);
  assert.deepEqual(JSON.parse(calls[2].input!), body);
  assert.equal(calls[2].args[4], "POST");
  assert.ok(!calls[2].args.some((arg) => arg.includes("private")));
});
