import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubReviews, searchQuery } from "./github";
import { filtersSchema } from "../shared/filters";
import { listInputSchema, PAGE_SIZE } from "../shared/contracts";

const head = "a".repeat(40), old = "b".repeat(40);
function node(number: number, changed = true) {
  return { databaseId: number + 1000, number, title: `PR ${number}`, url: `https://github.com/acme/web/pull/${number}`, state: "OPEN", isDraft: false,
    updatedAt: "2026-10-21T12:00:00Z", headRefOid: head, author: { login: "author" }, repository: { nameWithOwner: "acme/web" }, labels: { nodes: [{ name: "bug" }] },
    reviews: { nodes: [{ commit: { oid: changed ? old : head } }] } };
}
function response(nodes: unknown[], hasNextPage = false, issueCount = nodes.length, cursor: string | null = null) {
  return { data: { search: { nodes, issueCount, pageInfo: { hasNextPage, endCursor: cursor } } } };
}

test("awaiting and previously reviewed filters constrain GitHub search before pagination", async () => {
  for (const [reviewFilter, qualifier] of [["awaiting", "review-requested:me"], ["reviewed", "reviewed-by:me"]] as const) {
    const calls: string[][] = [];
    const service = new GitHubReviews(async (args) => { calls.push(args); return JSON.stringify(args[5] === "user" ? { login: "me" } : { total_count: 75, incomplete_results: false, items: [] }); });
    const result = await service.list({ reviewFilter, page: 2 }, filtersSchema.parse({ owners: ["acme", "octocat"] }));
    assert.ok(calls[1].includes(`q=is:pr is:open ${qualifier} (user:acme OR user:octocat)`));
    assert.ok(calls[1].includes("page=2")); assert.equal(result.totalCount, 75); assert.equal(result.reviewFilter, reviewFilter);
  }
  const filters = filtersSchema.parse({});
  assert.equal(searchQuery("me", "created", filters, new Date(), "outdated"), "is:pr is:open author:me");
  assert.equal(listInputSchema.safeParse({ reviewFilter: "all OR author:someone" }).success, false);
});

test("finds changed review heads beyond the first search page and paginates the filtered matches", async () => {
  const bodies: any[] = [];
  const service = new GitHubReviews(async (args, input) => {
    if (args[5] === "user") return JSON.stringify({ login: "me" });
    assert.equal(args[5], "graphql");
    const body = JSON.parse(input!); bodies.push(body);
    return JSON.stringify(body.variables.after === null
      ? response(Array.from({ length: 100 }, (_, index) => node(index + 1, false)), true, 151, "next")
      : response(Array.from({ length: 51 }, (_, index) => node(index + 101)), false, 151));
  });
  const first = await service.list({ reviewFilter: "outdated" }, filtersSchema.parse({ owners: ["acme"] }));
  assert.equal(first.pullRequests.length, PAGE_SIZE); assert.equal(first.totalCount, 51); assert.equal(first.nextPage, 2);
  assert.equal(first.pullRequests[0].number, 101); assert.equal(first.headsByPr["acme/web#101"], head);
  assert.equal(first.incomplete, false);
  assert.match(bodies[0].variables.search, /reviewed-by:me user:acme sort:updated-desc/);
  assert.equal(bodies[0].variables.login, "me");
  assert.match(bodies[0].query, /reviews\(author: \$login, last: 1, states:/);
  assert.ok(!bodies[0].query.includes("PENDING"));
  const second = await service.list({ reviewFilter: "outdated", page: 2 });
  assert.deepEqual(second.pullRequests.map((pr) => pr.number), [151]); assert.equal(second.nextPage, null);
});

test("marks missing reviews and GraphQL partial errors unknown instead of claiming an empty verified queue", async () => {
  const invalid = [null, { ...node(2), reviews: { nodes: [] } }, { ...node(3), reviews: { nodes: [{ commit: null }] } }, { ...node(4), url: "https://evil.example/pull/4" }];
  const service = new GitHubReviews(async (args) => JSON.stringify(args[5] === "user" ? { login: "me" }
    : { ...response([node(1), node(5, false), ...invalid]), errors: [{ message: "Private upstream detail" }] }));
  const result = await service.list({ reviewFilter: "outdated" });
  assert.deepEqual(result.pullRequests.map((pr) => pr.number), [1]); assert.equal(result.incomplete, true); assert.match(result.headWarning!, /incomplete/);
  assert.ok(!JSON.stringify(result).includes("Private upstream"));
  const missing = new GitHubReviews(async (args) => JSON.stringify(args[5] === "user" ? { login: "me" } : { errors: [{ message: "Internal error" }] }));
  await assert.rejects(missing.list({ reviewFilter: "outdated" }), /could not check commits/);
});

test("bounds search to 1,000 reviewed PRs and rejects repeated pagination cursors", async () => {
  let batches = 0;
  const service = new GitHubReviews(async (args) => {
    if (args[5] === "user") return JSON.stringify({ login: "me" });
    batches++;
    return JSON.stringify(response([node(batches)], true, 1001, `cursor-${batches}`));
  });
  const result = await service.list({ reviewFilter: "outdated" });
  assert.equal(batches, 10); assert.equal(result.capped, true);
  batches = 0;
  const repeated = new GitHubReviews(async (args) => {
    if (args[5] === "user") return JSON.stringify({ login: "me" });
    batches++; return JSON.stringify(response([node(1)], true, 50, "same"));
  });
  assert.equal((await repeated.list({ reviewFilter: "outdated" })).incomplete, true); assert.equal(batches, 2);
});

test("outdated filter retains authentication and connection failures as actionable errors", async () => {
  const service = new GitHubReviews(async (args) => {
    if (args[5] === "user") return JSON.stringify({ login: "me" });
    throw new Error("GitHub is rate-limiting requests. Wait a few minutes before refreshing.");
  });
  await assert.rejects(service.list({ reviewFilter: "outdated" }), /rate-limiting/);
});
