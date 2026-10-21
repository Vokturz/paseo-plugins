import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewPageCache, type ReviewPageRequest } from "../client/review-page-cache";
import { reviewPageSchema } from "../shared/contracts";
import { filtersSchema } from "../shared/filters";

const all: ReviewPageRequest = { page: 1, scope: "review-requested", reviewFilter: "all" };
const reviewed: ReviewPageRequest = { ...all, reviewFilter: "reviewed" };
function page(input = all, login = "reviewer", totalCount = 0) {
  return reviewPageSchema.parse({ ...input, login, totalCount, filters: filtersSchema.parse({}), pullRequests: [],
    nextPage: null, incomplete: false, capped: false, fetchedAt: new Date().toISOString() });
}

test("visited queues and pages switch without fetching again", async () => {
  const calls: ReviewPageRequest[] = [];
  const cache = new ReviewPageCache(async (input) => { calls.push(input); return page(input); });
  const first = await cache.load(all, "settings-one");
  await cache.load(reviewed, "settings-one");
  assert.equal(cache.read(all, "settings-one"), first);
  assert.equal(await cache.load(all, "settings-one"), first);
  await cache.load(reviewed, "settings-one");
  assert.equal(calls.length, 2);
  const secondPage = { ...all, page: 2 };
  await cache.load(secondPage, "settings-one");
  await cache.load(all, "settings-one");
  await cache.load(secondPage, "settings-one");
  assert.equal(calls.length, 3);
  await cache.load({ ...all, scope: "created", reviewFilter: "outdated" }, "settings-one");
  await cache.load({ ...all, scope: "created" }, "settings-one");
  assert.equal(calls.length, 4); assert.equal(calls[3].reviewFilter, "all");
});

test("switching back to an in-progress queue reuses its request", async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  let calls = 0;
  const cache = new ReviewPageCache(async () => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const first = cache.load(all, "one");
  const revisited = cache.load(all, "one");
  assert.equal(first, revisited); assert.equal(calls, 1);
  finish(page());
  assert.equal(await first, await revisited);
});

test("refresh replaces a cached page while failures preserve the last successful result", async () => {
  let calls = 0, failure = false;
  const cache = new ReviewPageCache(async (input) => { calls++; if (failure) throw new Error("Disconnected"); return page(input, "reviewer", calls); });
  const first = await cache.load(all, "one");
  const fresh = await cache.load(all, "one", true);
  assert.notEqual(first.totalCount, fresh.totalCount);
  assert.equal(await cache.load(all, "one"), fresh);
  failure = true;
  await assert.rejects(cache.load(all, "one", true), /Disconnected/);
  assert.equal(cache.read(all, "one"), fresh);
  failure = false;
  assert.equal((await cache.load(all, "one", true)).totalCount, 4);
});

test("saved-filter changes clear old pages and prevent old requests from restoring them", async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  let calls = 0;
  const cache = new ReviewPageCache(async (input) => ++calls === 1 ? new Promise((resolve) => { finish = resolve; }) : page(input, "reviewer", calls));
  const old = cache.load(all, "one");
  assert.equal(cache.read(all, "two"), undefined);
  const fresh = await cache.load(all, "two");
  finish(page(all, "reviewer", 99)); await old;
  assert.equal(cache.read(all, "two"), fresh); assert.equal(calls, 2);
});

test("account changes invalidate other views and ignore the previous account's late response", async () => {
  let login = "first";
  let finish!: (value: ReturnType<typeof page>) => void;
  const cache = new ReviewPageCache(async (input) => input.reviewFilter === "awaiting" ? new Promise((resolve) => { finish = resolve; }) : page(input, login));
  await cache.load(all, "one"); await cache.load(reviewed, "one");
  const awaiting = { ...all, reviewFilter: "awaiting" as const };
  const late = cache.load(awaiting, "one");
  login = "second";
  const fresh = await cache.load(all, "one", true);
  assert.equal(cache.read(reviewed, "one"), undefined);
  finish(page(awaiting, "first")); await late;
  assert.equal(cache.read(awaiting, "one"), undefined);
  assert.equal(cache.read(all, "one"), fresh);
  assert.equal((await cache.load(reviewed, "one")).login, "second");
});
