import assert from "node:assert/strict";
import { test } from "node:test";
import { OutcomePoller, type FetchOutcomes, type OutcomeState } from "../client/outcome-poller";
import { prKey, reviewOutcomeSchema } from "../shared/publication";

const target = (number: number) => ({ repository: "acme/web", number });
const empty: FetchOutcomes = async ({ targets }) => ({ runsByPr: Object.fromEntries(targets.map((pr) => [prKey(pr.repository, pr.number), []])), failedTargets: [] });

test("batches a full page, skips unlinked PRs, and polls only active reviews quickly", async () => {
  let now = 0;
  const calls: number[][] = [];
  const poller = new OutcomePoller(async (input) => { calls.push(input.targets.map((pr) => pr.number)); return empty(input); }, () => now);
  poller.poll(); await poller.flush(); assert.equal(calls.length, 0);
  for (let number = 1; number <= 50; number++) poller.watch(target(number), number === 1, () => {});
  await poller.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].length, 50);
  now = 10_000; poller.poll(); await poller.flush();
  assert.deepEqual(calls[1], [1]);
  now = 59_999; poller.poll(); await poller.flush();
  assert.deepEqual(calls[2], [1]);
  now = 60_000; poller.poll(); await poller.flush();
  assert.equal(calls[3].length, 49); assert.ok(!calls[3].includes(1));
});

test("suspends background requests, refreshes on foreground, and removes unmounted rows", async () => {
  let calls = 0;
  const poller = new OutcomePoller(async (input) => { calls++; return empty(input); });
  poller.setForeground(false);
  const remove = poller.watch(target(1), true, () => {});
  await poller.flush(); assert.equal(calls, 0);
  poller.setForeground(true); await poller.flush(); assert.equal(calls, 1);
  remove(); poller.setForeground(true); poller.poll(); await poller.flush(); assert.equal(calls, 1);
});

test("preserves successful statuses across partial and transport failures", async () => {
  const run = reviewOutcomeSchema.parse({ id: "17e8c7a2-7cfa-4dce-90a5-50bd1e93f5fa", agentId: "agent", repository: "acme/web", number: 1,
    headSha: "a".repeat(40), baseSha: "b".repeat(40), status: "published", reason: null, reviewUrl: "https://github.com/acme/web/pull/1#pullrequestreview-1", updatedAt: new Date().toISOString() });
  let fail = false, transportFailure = false;
  const states: OutcomeState[] = [];
  const fetch: FetchOutcomes = async (input): ReturnType<FetchOutcomes> => {
    if (transportFailure) throw new Error("Disconnected");
    return fail ? { runsByPr: {}, failedTargets: ["acme/web#1"] } : { ...(await empty(input)), runsByPr: { "acme/web#1": [run], "acme/web#2": [] } };
  };
  const poller = new OutcomePoller(fetch);
  poller.watch(target(1), true, (state) => states.push(state));
  const other: OutcomeState[] = [];
  poller.watch(target(2), false, (state) => other.push(state));
  await poller.flush();
  fail = true; poller.setForeground(true); await poller.flush();
  assert.deepEqual(states.at(-1)!.runs, [run]); assert.match(states.at(-1)!.error!, /unavailable/);
  transportFailure = true; poller.setForeground(true); await poller.flush();
  assert.deepEqual(states.at(-1)!.runs, [run]);
  fail = false; transportFailure = false; poller.setForeground(true); await poller.flush();
  assert.equal(states.at(-1)!.error, null); assert.equal(other.at(-1)!.error, null);
});

test("ignores stale responses and fetches a replacement subscription changed in flight", async () => {
  let finish!: (value: Awaited<ReturnType<FetchOutcomes>>) => void;
  let calls = 0, stale = 0, current = 0;
  const poller = new OutcomePoller(async (input) => ++calls === 1 ? new Promise((resolve) => { finish = resolve; }) : empty(input));
  const remove = poller.watch(target(1), true, () => stale++);
  const pending = poller.flush();
  remove();
  poller.watch(target(1), false, () => current++);
  finish({ runsByPr: { "acme/web#1": [] }, failedTargets: [] });
  await pending;
  assert.equal(stale, 0); assert.equal(current, 1); assert.equal(calls, 2);
});
