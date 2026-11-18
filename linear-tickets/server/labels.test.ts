import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_LIST_FILTER } from "../shared/contracts";
import { TicketCache } from "./cache";
import { buildPrompt, normalizeIssue } from "./context";
import { Credentials } from "./credentials";
import { CUSTOMERS_QUERY, LinearService, LIST_ISSUES_QUERY, WORKSPACE_LABELS_QUERY, listIssueFilter, listViewKey, type Post } from "./linear";
import { Settings } from "./settings";

const service = (post: Post) => new LinearService({ read: async () => ({ key: "lin_api_test", source: "saved" as const }) } as unknown as Credentials, post);

test("label filters OR within a group, AND across groups, and match by group and label name", () => {
  const filter = listIssueFilter(undefined, false, undefined, {
    ...DEFAULT_LIST_FILTER,
    labels: [{ group: "Area", name: "Wingman Web" }, { group: "Bug", name: "Reliability" }, { group: "Area", name: "Core API" }, { group: "", name: "tech-debt" }],
  });
  assert.deepEqual(filter.and, [
    { labels: { some: { name: { in: ["tech-debt"] } } } },
    { labels: { some: { name: { in: ["Core API", "Wingman Web"] }, parent: { name: { eq: "Area" } } } } },
    { labels: { some: { name: { in: ["Reliability"] }, parent: { name: { eq: "Bug" } } } } },
  ]);
});

test("a missing-group filter excludes every label of every group with that name", () => {
  const filter = listIssueFilter(undefined, false, undefined, { ...DEFAULT_LIST_FILTER, missingGroups: ["Area"] }, { Area: ["l-2", "l-1", "l-2"] });
  assert.deepEqual(filter.and, [{ labels: { every: { id: { nin: ["l-1", "l-2"] } } } }]);
});

test("customer filters select specific customers or any customer request", () => {
  assert.deepEqual(listIssueFilter(undefined, false, undefined, { ...DEFAULT_LIST_FILTER, customerIds: ["c-2", "c-1"] }).and, [{ needs: { some: { customer: { id: { in: ["c-1", "c-2"] } } } } }]);
  assert.deepEqual(listIssueFilter(undefined, false, undefined, { ...DEFAULT_LIST_FILTER, anyCustomer: true }).and, [{ customerCount: { gt: 0 } }]);
});

test("list view keys ignore filter order but not content", () => {
  const a = listViewKey({ ...DEFAULT_LIST_FILTER, labels: [{ group: "Area", name: "A" }, { group: "Area", name: "B" }] }, false);
  const b = listViewKey({ ...DEFAULT_LIST_FILTER, labels: [{ group: "Area", name: "B" }, { group: "Area", name: "A" }] }, false);
  assert.equal(a, b);
  assert.notEqual(a, listViewKey({ ...DEFAULT_LIST_FILTER, labels: [{ group: "Area", name: "A" }] }, false));
  assert.notEqual(a, listViewKey({ ...DEFAULT_LIST_FILTER, labels: [{ group: "Area", name: "A" }, { group: "Area", name: "B" }] }, true));
});

test("issues normalize label groups, customers, assignee and numeric priority", () => {
  const issue = normalizeIssue({
    id: "i-1", identifier: "OW-1", title: "Rotate keys", priority: 2, priorityLabel: "High",
    assignee: { id: "u-1", name: "Ivan" },
    labels: { nodes: [{ id: "l-1", name: "Infrastructure", color: "#5e6ad2", parent: { id: "g-1", name: "Area", groupType: "singleSelect" } }, { id: "l-2", name: "security", color: "#ff0000", parent: null }] },
    needs: { nodes: [{ customer: { id: "c-1", name: "Vueling" } }, { customer: { id: "c-1", name: "Vueling" } }, { customer: null }] },
  });
  assert.deepEqual(issue.labels, ["Area / Infrastructure", "security"]);
  assert.deepEqual(issue.labelInfo?.map((item) => [item.groupName, item.name, item.groupMulti]), [["Area", "Infrastructure", false], ["", "security", false]]);
  assert.deepEqual(issue.customers, [{ id: "c-1", name: "Vueling" }]);
  assert.equal(issue.assignee, "Ivan");
  assert.equal(issue.assigneeId, "u-1");
  assert.equal(issue.priorityValue, 2);
});

test("customer requests reach the prompt as a compact block", () => {
  const issue = normalizeIssue({ id: "i-1", identifier: "OW-1", title: "Rotate keys" });
  const prompt = buildPrompt({
    issue, teamId: null, projectId: null, context: "{}", warnings: [], relations: { parent: null, subissues: [], related: [] },
    customerRequests: [{ id: "n-1", customer: "Vueling", customerId: "c-1", customerUrl: "", tier: "Airline", important: true, content: "Needs   SSO\nbefore the POC", url: "", source: "ticket" }],
  }, "");
  assert.match(prompt, /Customer requests:\n- Vueling \(Airline\) \[important\]: Needs SSO before the POC/);
});

test("list requests send the scope and resolve missing groups through the workspace labels", async () => {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const linear = service(async (_key, query, variables) => {
    calls.push({ query, variables });
    if (query === WORKSPACE_LABELS_QUERY) return { issueLabels: { nodes: [
      { id: "l-1", name: "Core API", parent: { id: "g-1", name: "Area" }, team: null },
      { id: "l-9", name: "Core API", parent: { id: "g-9", name: "Area" }, team: { id: "t-2", name: "Ops" } },
      { id: "l-3", name: "Reliability", parent: { id: "g-2", name: "Bug" }, team: null },
    ], pageInfo: { hasNextPage: false } } };
    if (query === LIST_ISSUES_QUERY) return { issues: { nodes: [], pageInfo: { hasNextPage: false } } };
    throw new Error("unexpected query");
  });
  await linear.issues(undefined, undefined, false, undefined, { ...DEFAULT_LIST_FILTER, missingGroups: ["Area"] });
  const list = calls.find((call) => call.query === LIST_ISSUES_QUERY);
  assert.deepEqual((list?.variables.filter as { and: unknown }).and, [{ labels: { every: { id: { nin: ["l-1", "l-9"] } } } }]);
  // The label list is cached: a second request does not fetch it again.
  await linear.issues(undefined, undefined, false, undefined, { ...DEFAULT_LIST_FILTER, missingGroups: ["Area"] });
  assert.equal(calls.filter((call) => call.query === WORKSPACE_LABELS_QUERY).length, 1);
  await assert.rejects(linear.issues(undefined, undefined, false, undefined, { ...DEFAULT_LIST_FILTER, missingGroups: ["Nope"] }), /No Linear labels were found in the group "Nope"/);
});

test("customers report unavailable instead of failing when the workspace cannot list them", async () => {
  const failing = service(async (_key, query) => { if (query === CUSTOMERS_QUERY) throw new Error("Customers are not enabled"); return {}; });
  assert.deepEqual(await failing.customers(), { available: false, customers: [], message: "Customers are not enabled" });
  const working = service(async () => ({ customers: { nodes: [{ id: "c-2", name: "Vueling", tier: { displayName: "Airline" } }, { id: "c-1", name: "Air Transat", tier: null }], pageInfo: { hasNextPage: false } } }));
  assert.deepEqual(await working.customers(), { available: true, customers: [{ id: "c-1", name: "Air Transat", tier: "" }, { id: "c-2", name: "Vueling", tier: "Airline" }] });
});

test("the list view persists, survives other patches, and an invalid saved view is dropped", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linear-list-view-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const settings = new Settings(path);
  const listView = { layout: "board" as const, sortField: "priority" as const, sortDirection: "oldest" as const, status: "Todo", dependency: "blocked" as const, filter: { ...DEFAULT_LIST_FILTER, labels: [{ group: "Area", name: "Core API" }] } };
  await settings.patch({ listView });
  await settings.patch({ markInProgress: true });
  assert.deepEqual((await settings.read()).listView, listView);
  const raw = JSON.parse(await readFile(path, "utf8"));
  raw.listView.sortField = "bogus";
  await (await import("node:fs/promises")).writeFile(path, JSON.stringify(raw));
  assert.equal((await settings.read()).listView, null);
});

test("cached overviews are keyed by list view", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linear-cache-view-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = new TicketCache(join(directory, "cache.json"));
  await cache.saveIssues("scope", false, { issues: [], nextCursor: null }, "triage-view");
  assert.equal(await cache.read("scope", false), null);
  assert.ok(await cache.read("scope", false, "triage-view"));
});

test("the last used project persists and an invalid one is dropped", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linear-last-project-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new Settings(join(directory, "settings.json"));
  await settings.patch({ lastProject: { projectId: "p-1", baseBranch: "refs/heads/main" } });
  assert.deepEqual((await settings.read()).lastProject, { projectId: "p-1", baseBranch: "refs/heads/main" });
  await settings.patch({ lastProject: { projectId: "" } });
  assert.equal((await settings.read()).lastProject, null);
});
