import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TicketCache, cacheScope } from "./cache";
import type { Issue } from "../shared/contracts";

const issue: Issue = {
  id: "issue-1", identifier: "ENG-42", title: "Cached ticket", url: "https://linear.app/acme/issue/ENG-42/cached-ticket",
  status: "Todo", statusType: "unstarted", branchName: "", priority: "High", dueDate: null, estimate: null,
  project: "App", description: "", team: "Engineering", labels: [], updatedAt: "2026-09-21T10:00:00Z", createdAt: "2026-09-20T10:00:00Z",
  blockingCount: 0, blockedByCount: 0,
};

test("persists the latest overview and merges counts without storing the API key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-linear-cache-"));
  const path = join(directory, "cache.json");
  const cache = new TicketCache(path);
  const scope = cacheScope("lin_api_secret");
  try {
    await cache.saveIssues(scope, false, { issues: [issue], nextCursor: "next" });
    await cache.saveCounts(scope, false, { total: 1, byName: { Todo: 1 }, byType: { unstarted: 1 }, complete: true });
    const value = await cache.read(scope, false);
    assert.equal(value?.issues[0].identifier, "ENG-42");
    assert.equal(value?.nextCursor, "next");
    assert.equal(value?.counts?.total, 1);
    assert.ok(Number.isFinite(Date.parse(value?.updatedAt ?? "")));
    assert.doesNotMatch(await readFile(path, "utf8"), /lin_api_secret/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("isolates cached tickets by account and closed-ticket scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-linear-cache-"));
  const cache = new TicketCache(join(directory, "cache.json"));
  try {
    await cache.saveIssues(cacheScope("account-a"), false, { issues: [issue], nextCursor: null });
    assert.equal(await cache.read(cacheScope("account-b"), false), null);
    assert.equal(await cache.read(cacheScope("account-a"), true), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
