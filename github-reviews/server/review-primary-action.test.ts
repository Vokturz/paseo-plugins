import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewPrimaryAction } from "../client/review-primary-action";
import type { ReviewAgent } from "../client/review-agents";
import { reviewOutcomeSchema } from "../shared/publication";

const head = "a".repeat(40), base = "b".repeat(40);
const id = "17e8c7a2-7cfa-4dce-90a5-50bd1e93f5fa";
const idle: ReviewAgent = { id, title: "Review", status: "idle", updatedAt: "2026-10-21T12:00:00Z", runId: id, headSha: head };
const defaults: Parameters<typeof reviewPrimaryAction>[0] = { agents: [], runs: [], currentHead: head, busy: false, loading: false, configured: true, canLaunch: true, projectId: "project", draft: false };
const run = reviewOutcomeSchema.parse({ id, agentId: id, repository: "acme/web", number: 42, headSha: head, baseSha: base,
  status: "published", reason: null, reviewUrl: "https://github.com/acme/web/pull/42#pullrequestreview-1", updatedAt: idle.updatedAt });

test("initial actions explain loading, configuration, project selection and draft mode", () => {
  assert.equal(reviewPrimaryAction(defaults).kind, "start");
  assert.equal(reviewPrimaryAction({ ...defaults, draft: true }).label, "Review draft locally");
  assert.equal(reviewPrimaryAction({ ...defaults, loading: true }).kind, "checking");
  assert.equal(reviewPrimaryAction({ ...defaults, failed: true }).kind, "retry-status");
  assert.equal(reviewPrimaryAction({ ...defaults, configured: false }).kind, "configure");
  assert.equal(reviewPrimaryAction({ ...defaults, projectId: "" }).kind, "choose-project");
  assert.equal(reviewPrimaryAction({ ...defaults, canLaunch: false }).kind, "open-pr");
});

test("active agents take priority over historical publication and never offer another launch", () => {
  const active: ReviewAgent = { ...idle, id: "other", runId: null, status: "running" };
  assert.deepEqual(reviewPrimaryAction({ ...defaults, agents: [idle, active], runs: [run] }), { kind: "open-agent", label: "Open agent", agentId: "other" });
  assert.equal(reviewPrimaryAction({ ...defaults, agents: [idle], busy: true }).kind, "starting");
  assert.deepEqual(reviewPrimaryAction({ ...defaults, loading: true, createdAgentId: "just-created" }), { kind: "open-agent", label: "Open agent", agentId: "just-created" });
});

test("published runs open their verified review; other outcomes open the existing agent", () => {
  assert.deepEqual(reviewPrimaryAction({ ...defaults, agents: [idle], runs: [run] }), { kind: "view-review", label: "View review", url: run.reviewUrl });
  for (const status of ["blocked", "completed", "skipped"] as const) {
    assert.deepEqual(reviewPrimaryAction({ ...defaults, agents: [idle], runs: [{ ...run, status, reviewUrl: null }] }), { kind: "open-agent", label: "Open agent", agentId: id });
  }
  assert.equal(reviewPrimaryAction({ ...defaults, agents: [idle], runs: [] }).kind, "open-agent");
  // Once an archived agent is absent from the restored list, a new review is available.
  assert.equal(reviewPrimaryAction({ ...defaults, agents: [], createdAgentId: undefined }).kind, "start");
});
