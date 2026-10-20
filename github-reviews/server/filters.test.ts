import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server";
import { filterSettings, filtersSchema, filterSummary, ownerChoices, timeWindowOptions, type Filters } from "../shared/filters";
import type { ReviewPage } from "../shared/contracts";
import { GitHubReviews, searchQuery } from "./github";

const now = new Date("2026-10-20T15:30:00.000Z");

test("local settings have unrestricted defaults and normalize owner names", () => {
  assert.equal(filterSettings.scope, "host");
  assert.deepEqual(filtersSchema.parse({}), { owners: [], days: null, dateField: "updated" });
  const filters = filtersSchema.parse({ owners: [" @OpenAI ", "octocat", "openai", "github"], days: 30, dateField: "created" });
  assert.deepEqual(filters, { owners: ["openai", "octocat", "github"], days: 30, dateField: "created" });
  assert.deepEqual(filtersSchema.parse(JSON.parse(JSON.stringify(filters))), filters);
  assert.match(filterSummary(filters), /openai, octocat, github · Created in the last 30 days/);
  assert.equal(filterSummary(filtersSchema.parse({})), "All organizations and users · Any time");
});

test("saved filter validation rejects query syntax, URLs, invalid days and excessive owner lists", () => {
  for (const owners of ["openai/cli", "https://github.com/openai", "org:openai", "someone OR author:other", "-owner", "@"])
    assert.throws(() => filtersSchema.parse({ owners: [owners] }));
  for (const days of [0, -1, 1.5, 3651, Infinity, "30"])
    assert.equal(filtersSchema.safeParse({ days }).success, false);
  assert.throws(() => filtersSchema.parse({ owners: Array.from({ length: 11 }, (_, i) => `owner${i}`) }), /at most 10/);
  assert.throws(() => filtersSchema.parse({ owners: Array.from({ length: 5 }, (_, i) => `owner${i}${"x".repeat(30)}`) }), /shorter owner list/);
  assert.equal(filtersSchema.parse({ days: null }).days, null);
  assert.equal(filtersSchema.parse({ days: 3650 }).days, 3650);
});

test("owner choices preserve saved selections, deduplicate pages and retain organization metadata", () => {
  assert.deepEqual(ownerChoices([
    { login: "OpenAI", kind: "organization" }, { login: "octocat", kind: "user" }, { login: "openai", kind: "organization" },
  ], ["saved-org", "OPENAI"]), [
    { login: "octocat", kind: "user" }, { login: "openai", kind: "organization" }, { login: "saved-org" },
  ]);
});

test("time presets preserve existing custom windows without changing stored values", () => {
  const defaults = timeWindowOptions(null);
  assert.deepEqual(defaults.map((option) => option.days), [null, 1, 7, 14, 30, 90, 180, 365]);
  assert.equal(timeWindowOptions(30).length, defaults.length);
  assert.deepEqual(timeWindowOptions(42).at(-1), { days: 42, label: "Last 42 days" });
  assert.equal(filtersSchema.parse({ days: 42 }).days, 42);
});

test("query keeps the selected PR scope and combines any owner with the time window", () => {
  const filters = filtersSchema.parse({ owners: ["OpenAI", "octocat"], days: 7, dateField: "created" });
  assert.equal(searchQuery("reviewer", "review-requested", filters, now),
    "is:pr is:open (review-requested:reviewer OR reviewed-by:reviewer) (user:openai OR user:octocat) created:>=2026-10-13T15:30:00Z");
  assert.equal(searchQuery("reviewer", "created", { ...filters, dateField: "updated" }, now),
    "is:pr is:open author:reviewer user:openai user:octocat updated:>=2026-10-13T15:30:00Z");
  assert.equal(searchQuery("reviewer", "created", filtersSchema.parse({}), now), "is:pr is:open author:reviewer");
});

test("time windows use elapsed UTC days across leap days and daylight saving boundaries", () => {
  const filters = filtersSchema.parse({ days: 1 });
  assert.match(searchQuery("reviewer", "created", filters, new Date("2024-03-01T00:00:00Z")), /updated:>=2024-02-29T00:00:00Z$/);
  assert.match(searchQuery("reviewer", "created", filters, new Date("2026-10-25T12:00:00+01:00")), /updated:>=2026-10-24T11:00:00Z$/);
});

test("saved filters constrain the GitHub request before pagination and totals", async () => {
  const calls: string[][] = [];
  const service = new GitHubReviews(async (args) => {
    calls.push(args);
    return JSON.stringify(args.includes("user") ? { login: "me" } : { total_count: 75, incomplete_results: false, items: [] });
  });
  const filters = filtersSchema.parse({ owners: ["acme", "my-user"], days: 30 });
  const page = await service.list({ scope: "created", page: 2 }, filters);
  const query = calls[1].find((arg) => arg.startsWith("q="))!;
  assert.match(query, /^q=is:pr is:open author:me user:acme user:my-user updated:>=/);
  assert.ok(calls[1].includes("page=2"));
  assert.equal(page.totalCount, 75);
  assert.deepEqual(page.filters, filters);
});

test("invalid saved filters never silently broaden the query", async () => {
  let calls = 0;
  const service = new GitHubReviews(async () => { calls++; return "{}"; });
  await assert.rejects(service.list({}, { owners: ["acme OR author:someone"], days: null, dateField: "updated" }));
  assert.equal(calls, 0);
});

test("list handler reads the locally persisted settings on every call and refuses invalid storage", async (t) => {
  let saved: { status: "ready"; revision: string; values: Filters } | { status: "invalid"; revision: string; error: string } = {
    status: "ready", revision: "one", values: filtersSchema.parse({ owners: ["first"] }),
  };
  let handler: ((input: { page: number; scope: "created" }, context: { paseo: unknown }) => Promise<unknown>) | undefined;
  const received: Filters[] = [];
  t.mock.method(GitHubReviews.prototype, "list", async (_input: Parameters<GitHubReviews["list"]>[0], filters?: Filters) => {
    received.push(filters!);
    return { pullRequests: [] } as unknown as ReviewPage;
  });
  contribute({
    registerSettings() { return { read: async () => saved }; },
    handle(contract: { name: string }, callback: typeof handler) { if (contract.name === "github-reviews.list") handler = callback; },
  } as unknown as PluginServerContext);
  assert.ok(handler);
  await handler({ page: 1, scope: "created" }, { paseo: {} });
  saved = { status: "ready", revision: "two", values: filtersSchema.parse({ days: 7 }) };
  await handler({ page: 1, scope: "created" }, { paseo: {} });
  assert.deepEqual(received, [filtersSchema.parse({ owners: ["first"] }), filtersSchema.parse({ days: 7 })]);
  saved = { status: "invalid", revision: "three", error: "Malformed settings" };
  await assert.rejects(handler({ page: 1, scope: "created" }, { paseo: {} }), /saved PR filters are invalid/);
  assert.equal(received.length, 2);
});
