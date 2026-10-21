import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoAgent, PaseoAgentListOptions, PaseoAgentListResult, PaseoAgentUpdate } from "@getpaseo/client";
import { watchReviewAgents, type ReviewAgentsState } from "../client/review-agents";

type Source = Parameters<typeof watchReviewAgents>[0];
const tick = () => new Promise((resolve) => setImmediate(resolve));
function agent(id: string, patch: Partial<PaseoAgent> = {}): PaseoAgent {
  return { id, title: `Review ${id}`, status: "idle", updatedAt: "2026-10-20T12:00:00Z", archivedAt: null,
    labels: { "github.repository": "acme/web", "github.prNumber": "42" }, ...patch } as PaseoAgent;
}
function fixture(list: (options: PaseoAgentListOptions) => Promise<unknown>) {
  let listener: ((update: PaseoAgentUpdate) => void) | undefined;
  let unsubscribed = 0;
  const states: ReviewAgentsState[] = [];
  const source = { list, subscribe: (callback: typeof listener) => { listener = callback; return () => { listener = undefined; unsubscribed++; }; } } as Source;
  return { source, states, latest: () => states.at(-1)!, emit: (update: PaseoAgentUpdate) => listener?.(update), unsubscribed: () => unsubscribed };
}
function page(agents: PaseoAgent[], nextCursor: string | null = null) {
  return { entries: agents.map((agent) => ({ agent })), pageInfo: { hasMore: Boolean(nextCursor), nextCursor } };
}

test("restores all unarchived PR agents from durable labels, with pagination and latest first", async () => {
  const calls: PaseoAgentListOptions[] = [];
  let released = 0;
  const f = fixture(async (options) => {
    calls.push(options);
    return options.page?.cursor ? page([agent("newest", { updatedAt: "2026-10-20T13:00:00Z" })])
      : { ...page([agent("older"), agent("archived", { archivedAt: "2026-10-20T14:00:00Z" }), agent("other-pr", { labels: { "github.repository": "acme/web", "github.prNumber": "43" } })], "next"), subscription: { subscribe: () => () => {}, release: async () => { released++; } } };
  });
  const watcher = watchReviewAgents(f.source, "Acme/Web", 42, (state) => f.states.push(state));
  await tick();
  assert.deepEqual(f.latest().agents.map((agent) => agent.id), ["newest", "older"]);
  assert.deepEqual(calls[0].filter, { labels: { "github.repository": "acme/web", "github.prNumber": "42" }, includeArchived: false });
  assert.deepEqual(calls[0].subscribe, {});
  assert.equal(calls[1].page?.cursor, "next");
  assert.equal(calls[1].subscribe, undefined);
  watcher.dispose(); await tick();
  assert.equal(released, 1); assert.equal(f.unsubscribed(), 1);
});

test("archive, removal, label changes and new runs update the linked list immediately", async () => {
  const f = fixture(async () => page([agent("first"), agent("second")]));
  const watcher = watchReviewAgents(f.source, "acme/web", 42, (state) => f.states.push(state));
  await tick();
  f.emit({ kind: "upsert", agent: agent("first", { archivedAt: "2026-10-20T14:00:00Z" }) });
  assert.deepEqual(f.latest().agents.map((agent) => agent.id), ["second"]);
  f.emit({ kind: "remove", agentId: "second" });
  assert.equal(f.latest().agents.length, 0);
  f.emit({ kind: "upsert", agent: agent("third", { status: "running" }) });
  assert.equal(f.latest().agents[0].status, "running");
  f.emit({ kind: "upsert", agent: agent("third", { labels: { "github.repository": "different/web", "github.prNumber": "42" } }) });
  assert.equal(f.latest().agents.length, 0);
  watcher.dispose();
});

test("an archive during initial loading wins over the stale list response", async () => {
  let complete!: (result: unknown) => void;
  const f = fixture(() => new Promise((resolve) => { complete = resolve; }));
  const watcher = watchReviewAgents(f.source, "acme/web", 42, (state) => f.states.push(state));
  f.emit({ kind: "upsert", agent: agent("archiving", { archivedAt: "2026-10-20T14:00:00Z" }) });
  f.emit({ kind: "upsert", agent: agent("new") });
  complete(page([agent("archiving")]));
  await tick();
  assert.deepEqual(f.latest().agents.map((agent) => agent.id), ["new"]);
  watcher.dispose();
});

test("a fresh watcher recovers agents after remount without client launch state", async () => {
  const f = fixture(async () => page([agent("persisted")]));
  const first = watchReviewAgents(f.source, "acme/web", 42, (state) => f.states.push(state));
  await tick(); first.dispose();
  const second = watchReviewAgents(f.source, "acme/web", 42, (state) => f.states.push(state));
  await tick();
  assert.equal(f.latest().agents[0].id, "persisted");
  second.dispose();
});

test("uses its owned updates, ignores removals from other filters, and refreshes after reconnect", async () => {
  type Observer = Parameters<NonNullable<PaseoAgentListResult["subscription"]>["subscribe"]>[0];
  let observer!: Observer;
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return { ...page([agent(calls === 1 ? "first" : "after-reconnect")]), requestId: "initial", subscription: {
      subscribe: (value: Observer) => { observer = value; return () => {}; }, release: async () => {},
    } };
  });
  const watcher = watchReviewAgents(f.source, "acme/web", 42, (state) => f.states.push(state));
  await tick();
  f.emit({ kind: "remove", agentId: "first", subscriptionId: "other-filter" });
  assert.equal(f.latest().agents[0].id, "first");
  observer.update({ type: "agent_update", payload: { kind: "remove", agentId: "first", subscriptionId: "owned-filter" } });
  assert.equal(f.latest().agents.length, 0);
  observer.snapshot({ ...page([]), requestId: "reconnected", subscriptionId: "owned-filter" } as Parameters<Observer["snapshot"]>[0]);
  await tick();
  assert.equal(f.latest().agents[0].id, "after-reconnect");
  watcher.dispose();
});

test("failed reads expose an error and can retry, without assuming agents are missing", async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error("private details"); return page([agent("recovered")]); });
  const watcher = watchReviewAgents(f.source, "acme/web", 42, (state) => f.states.push(state));
  await tick();
  assert.match(f.latest().error!, /Could not load linked/);
  fail = false; await watcher.refresh();
  assert.equal(f.latest().error, null); assert.equal(f.latest().agents[0].id, "recovered");
  watcher.dispose();
});

test("disposing while a subscription read is pending releases it without updating the old view", async () => {
  let complete!: (result: unknown) => void;
  let released = 0;
  const f = fixture(() => new Promise((resolve) => { complete = resolve; }));
  const watcher = watchReviewAgents(f.source, "acme/web", 42, (state) => f.states.push(state));
  watcher.dispose(); const count = f.states.length;
  complete({ ...page([agent("late")]), subscription: { subscribe: () => () => {}, release: async () => { released++; } } });
  await tick();
  assert.equal(f.states.length, count); assert.equal(released, 1);
});
