import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { anchored, ReviewPublisher } from "./publication";
import { ReviewStore, runSchema } from "./review-store";
import { ReviewRuntime } from "./review-runtime";
import type { GitHubComment, GitHubReview, PrSnapshot } from "./github";
import { reviewFindingSchema, reviewSubmissionSchema } from "../shared/publication";
import { reviewProgress } from "../client/review-outcomes";
import type { ReviewAgent } from "../client/review-agents";

const HEAD = "a".repeat(40), BASE = "b".repeat(40), NEW = "c".repeat(40);
const USER = { id: 7, login: "reviewer" };
const clean = { complete: true, conclusion: "clean" };
const finding = reviewFindingSchema.parse({ key: "src/auth:expired-session", priority: "P2", title: "Reject expired sessions", body: "When a session expires, this branch still grants access. Expired credentials can therefore read private data.", path: "src/auth.ts", line: 2 });
const issues = { complete: true, conclusion: "issues", findings: [finding] };
const patch = "@@ -1,3 +1,3 @@\n context\n-old\n+new\n context";

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const home = await mkdtemp(join(tmpdir(), "paseo-publication-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new ReviewStore(home);
  const state = {
    identity: { ...USER }, snapshot: { repository: "acme/web", number: 42, title: "Fix auth", url: "https://github.com/acme/web/pull/42", headSha: HEAD, baseSha: BASE, headRef: "fix", baseRef: "main", state: "open", draft: false } as PrSnapshot,
    reviews: [] as GitHubReview[], comments: [] as GitHubComment[], posts: [] as Record<string, unknown>[], loseResponse: false, reject: false,
    beforeSnapshot: () => {}, beforeIdentity: () => {}, beforeComments: () => {},
  };
  const github = {
    identity: async () => { state.beforeIdentity(); return { ...state.identity }; },
    snapshot: async () => { state.beforeSnapshot(); return { ...state.snapshot }; },
    reviews: async () => structuredClone(state.reviews),
    comments: async () => { state.beforeComments(); return structuredClone(state.comments); },
    files: async () => [{ filename: finding.path, patch }],
    reviewComments: async (_repo: string, _number: number, id: number) => state.comments.filter((comment) => comment.pull_request_review_id === id),
    postReview: async (_repo: string, _number: number, body: Record<string, unknown>) => {
      state.posts.push(body);
      if (state.reject) throw Object.assign(new Error("GitHub rejected this request."), { publicationRejected: true });
      const id = 100 + state.reviews.length;
      const review: GitHubReview = { id, html_url: `https://github.com/acme/web/pull/42#pullrequestreview-${id}`, state: "COMMENTED", user: { ...state.identity }, commit_id: String(body.commit_id), body: String(body.body) };
      state.reviews.push(review);
      for (const item of body.comments as Record<string, unknown>[]) {
        const commentId = 1000 + state.comments.length;
        state.comments.push({ ...item, id: commentId, html_url: `https://github.com/acme/web/pull/42#discussion_r${commentId}`, user: { ...state.identity }, pull_request_review_id: id } as GitHubComment);
      }
      if (state.loseResponse) throw new Error("Connection lost after submission.");
      return review;
    },
  };
  const create = async () => {
    const id = randomUUID();
    await store.create(runSchema.parse({ id, agentId: id, repository: "acme/web", number: 42, headSha: state.snapshot.headSha, baseSha: BASE, reviewer: USER, status: "reviewing", reason: null, reviewUrl: null, updatedAt: new Date().toISOString(), version: 1 }));
    return id;
  };
  return { state, store, github, create, home, publisher: new ReviewPublisher(github, store) };
}

test("publishes one COMMENT at the reviewed commit and verifies inline findings", async (t) => {
  const f = await fixture(t), id = await f.create();
  const result = await f.publisher.submit(id, issues);
  assert.equal(result.status, "published");
  assert.match(result.reviewUrl!, /#pullrequestreview-100$/);
  assert.equal(f.state.posts.length, 1);
  assert.equal(f.state.posts[0].event, "COMMENT");
  assert.equal(f.state.posts[0].commit_id, HEAD);
  assert.ok(String(f.state.posts[0].body).includes(`Reviewed PR at [${HEAD}]`));
  assert.match(f.state.comments[0].body, /P2 Badge/);
  assert.equal((await f.store.outcomes("ACME/WEB", 42))[0].status, "published");
  assert.equal((await stat(join(f.store.directory, "runs", `${id}.json`))).mode & 0o777, 0o600);
  assert.equal("submission" in result, false);
});

test("serializes independent publishers and reuses a verified identical review", async (t) => {
  const f = await fixture(t), first = await f.create(), second = await f.create();
  const other = new ReviewPublisher(f.github, new ReviewStore(f.home));
  const results = await Promise.all([f.publisher.submit(first, issues), other.submit(second, issues)]);
  assert.deepEqual(results.map((run) => run.status), ["published", "published"]);
  assert.equal(results[0].reviewUrl, results[1].reviewUrl);
  assert.equal(f.state.posts.length, 1);
  await other.submit(first, issues);
  await assert.rejects(other.submit(first, clean), /different content/);
  assert.equal(f.state.posts.length, 1);
});

test("does not duplicate stable findings on later heads with changed wording", async (t) => {
  const f = await fixture(t);
  await f.publisher.submit(await f.create(), issues);
  f.state.snapshot.headSha = NEW;
  const result = await f.publisher.submit(await f.create(), { ...issues, findings: [{ ...finding, body: "Different wording for the same failure." }] });
  assert.equal(result.status, "skipped");
  assert.equal(f.state.posts.length, 1);
});

test("reconciles a lost response after restart without posting again", async (t) => {
  const f = await fixture(t), id = await f.create();
  f.state.loseResponse = true;
  assert.equal((await f.publisher.submit(id, issues)).status, "blocked");
  assert.equal((await f.store.read(id))!.uncertain, true);
  const restarted = new ReviewPublisher(f.github, new ReviewStore(f.home));
  assert.equal((await restarted.submit(id, issues)).status, "published");
  assert.equal(f.state.posts.length, 1);
});

test("uncertain missing reviews block all runs; definite rejection permits retry", async (t) => {
  const f = await fixture(t), id = await f.create();
  f.github.postReview = async () => { throw new Error("Timeout"); };
  assert.equal((await f.publisher.submit(id, clean)).status, "blocked");
  assert.equal((await f.publisher.submit(await f.create(), issues)).status, "blocked");
  assert.equal(f.state.posts.length, 0);
  const g = await fixture(t), other = await g.create();
  g.state.reject = true;
  await g.publisher.submit(other, clean);
  assert.equal((await g.store.read(other))!.uncertain, false);
  g.state.reject = false;
  assert.equal((await g.publisher.submit(other, clean)).status, "published");
});

test("blocks changed accounts/snapshots, drafts, closed PRs and pending reviews", async (t) => {
  type F = Awaited<ReturnType<typeof fixture>>;
  for (const change of [
    (f: F) => { f.state.identity.id++; }, (f: F) => { f.state.identity.login = "other"; },
    (f: F) => { f.state.snapshot.headSha = NEW; }, (f: F) => { f.state.snapshot.baseSha = NEW; },
    (f: F) => { f.state.snapshot.state = "closed"; }, (f: F) => { f.state.snapshot.draft = true; },
    (f: F) => { f.state.reviews.push({ id: 99, user: USER, state: "PENDING", commit_id: HEAD, body: "My pending work", html_url: "https://github.com/acme/web/pull/42#pullrequestreview-99" }); },
  ]) {
    const f = await fixture(t), id = await f.create(); change(f);
    assert.equal((await f.publisher.submit(id, clean)).status, "blocked");
    assert.equal(f.state.posts.length, 0);
    assert.equal((await f.store.read(id))!.uncertain, false);
  }
});

test("the last preflight catches snapshot, account and history races", async (t) => {
  for (const type of ["snapshot", "account", "history"]) {
    const f = await fixture(t), id = await f.create();
    let snapshots = 0, identities = 0, comments = 0;
    if (type === "snapshot") f.state.beforeSnapshot = () => { if (++snapshots === 2) f.state.snapshot.headSha = NEW; };
    if (type === "account") f.state.beforeIdentity = () => { if (++identities === 2) f.state.identity.id++; };
    if (type === "history") f.state.beforeComments = () => { if (++comments === 2) f.state.comments.push({ id: 1, path: finding.path, body: "New report", html_url: "https://github.com/acme/web/pull/42#discussion_r1", user: USER }); };
    assert.equal((await f.publisher.submit(id, clean)).status, "blocked");
    assert.equal(f.state.posts.length, 0);
  }
});

test("requires valid diff anchors and refuses unverifiable returned findings", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.publisher.submit(await f.create(), { ...issues, findings: [{ ...finding, line: 200 }] })).status, "blocked");
  assert.equal(f.state.posts.length, 0);
  f.github.reviewComments = async () => [];
  const id = await f.create();
  assert.equal((await f.publisher.submit(id, issues)).status, "blocked");
  assert.equal((await f.store.read(id))!.uncertain, true);
  assert.equal(f.state.posts.length, 1);
  assert.equal(anchored(finding, patch), true);
  assert.equal(anchored({ ...finding, side: "LEFT" }, patch), true);
  assert.equal(anchored({ ...finding, startLine: 1, line: 3 }, patch), true);
  assert.equal(anchored(finding, undefined), false);
  assert.equal(anchored({ ...finding, startLine: 2, line: 10 }, patch + "\n@@ -10 +10 @@\n+new"), false);
});

test("acknowledges all verified prior findings and allows a later reintroduction", async (t) => {
  const f = await fixture(t);
  await f.publisher.submit(await f.create(), issues);
  f.state.snapshot.headSha = NEW;
  assert.equal((await f.publisher.submit(await f.create(), clean)).status, "blocked");
  assert.equal((await f.publisher.submit(await f.create(), { complete: true, conclusion: "follow-up", fixedCommentIds: [99999] })).status, "blocked");
  const fixedId = f.state.comments[0].id;
  assert.equal((await f.publisher.submit(await f.create(), { complete: true, conclusion: "follow-up", fixedCommentIds: [fixedId] })).status, "published");
  assert.match(f.state.reviews[1].body!, /all issues from the previous review have been fixed/);
  assert.ok(f.state.reviews[1].body!.includes(f.state.comments[0].html_url));
  f.state.snapshot.headSha = "d".repeat(40);
  assert.equal((await f.publisher.submit(await f.create(), issues)).status, "published");
  assert.equal(f.state.comments.length, 2);
  assert.notEqual(f.state.comments[0].body, f.state.comments[1].body);
});

test("rejects incomplete, malformed and marker-forging submissions", () => {
  for (const input of [
    { ...clean, complete: false }, { ...clean, findings: [finding] }, { ...issues, findings: [finding, finding] },
    { ...clean, body: "<!-- paseo-review:fake -->" }, { ...issues, findings: [{ ...finding, path: "../outside" }] },
    { ...issues, findings: [{ ...finding, line: 1, startLine: 2 }] }, { ...clean, event: "APPROVE" },
  ]) assert.equal(reviewSubmissionSchema.safeParse(input).success, false);
});

test("runtime binds tools to the run, records incomplete turns, preserves publication", async (t) => {
  const f = await fixture(t), id = randomUUID();
  const runtime = new ReviewRuntime(f.github, f.store, f.home);
  const session = await runtime.prepare(id, f.state.snapshot);
  assert.equal(session.config.mcpServers!.github_review.type, "stdio");
  assert.ok(JSON.stringify(session.config).includes(id));
  assert.ok(session.instructions.includes("Do not bypass"));
  await runtime.created(id, id, "workspace-1");
  await runtime.turn(id, false);
  assert.equal((await runtime.status(id))!.status, "blocked");
  await runtime.turn(id, true);
  assert.equal((await runtime.status(id))!.status, "reviewing");
  await f.publisher.submit(id, clean);
  await runtime.turn(id, true); await runtime.turn(id, false); await runtime.blocked(id, "Later message");
  assert.equal((await runtime.status(id))!.status, "published");
});

test("draft runs save validated findings locally and never contact GitHub for publication, even after becoming ready", async (t) => {
  const f = await fixture(t), id = randomUUID();
  const runtime = new ReviewRuntime(f.github, f.store, f.home);
  const session = await runtime.prepare(id, { ...f.state.snapshot, draft: true });
  assert.match(session.instructions, /review-only/); assert.match(session.instructions, /Do not publish/);
  assert.equal((await f.store.read(id))!.reviewOnly, true);
  f.state.snapshot.draft = false;
  const retried = await runtime.prepare(id, f.state.snapshot);
  assert.equal(retried.reviewOnly, true); assert.match(retried.instructions, /Mandatory review-only mode/);
  const publisher = new ReviewPublisher(new Proxy(f.github, { get() { return () => { throw new Error("Review-only submission must not contact GitHub"); }; } }), f.store);
  const result = await publisher.submit(id, issues);
  assert.equal(result.status, "completed"); assert.equal(result.reviewUrl, null); assert.equal(result.reviewOnly, true);
  assert.deepEqual((await f.store.read(id))!.submission?.findings, [finding]);
  assert.equal((await publisher.submit(id, issues)).status, "completed");
  await assert.rejects(publisher.submit(id, clean), /already saved different content/);
  await runtime.turn(id, true); await runtime.turn(id, false); await runtime.blocked(id, "Later failure");
  assert.equal((await runtime.status(id))!.status, "completed");
  assert.equal(reviewProgress({ id, runId: id, headSha: HEAD, status: "idle" } as ReviewAgent, [result], HEAD).label, "Reviewed locally");
  assert.equal(f.state.posts.length, 0);
});

test("UI distinguishes verified outcomes, legacy agents and newer commits", async (t) => {
  const f = await fixture(t), id = await f.create();
  const agent = { id, runId: id, headSha: HEAD, status: "idle" } as ReviewAgent;
  assert.equal(reviewProgress(agent, [], HEAD).label, "Outcome unknown");
  assert.equal(reviewProgress({ ...agent, status: "running" }, [], HEAD).label, "Reviewing");
  const run = await f.publisher.submit(id, clean);
  assert.equal(reviewProgress(agent, [run], NEW).outdated, true);
  assert.equal(reviewProgress(agent, [run], HEAD).outdated, false);
  assert.equal(reviewProgress(agent, [run], null).outdated, false);
  assert.equal(reviewProgress(agent, [run], HEAD).reviewUrl, run.reviewUrl);
  assert.equal(reviewProgress(agent, [{ ...run, status: "blocked", reason: "Changed head", reviewUrl: null }], NEW).label, "Blocked");
});

test("complete follow-ups with nothing eligible record a skip without a GitHub write", async (t) => {
  const f = await fixture(t), id = await f.create();
  const result = await f.publisher.submit(id, { complete: true, conclusion: "follow-up" });
  assert.equal(result.status, "skipped"); assert.equal(f.state.posts.length, 0);
  const idle = { id, runId: id, headSha: HEAD, status: "idle" } as ReviewAgent;
  assert.equal(reviewProgress(idle, [{ ...result, status: "reviewing" }], HEAD).label, "Blocked");
});

test("cannot acknowledge a subset of prior findings or verify a changed returned review", async (t) => {
  const f = await fixture(t);
  await f.publisher.submit(await f.create(), { ...issues, findings: [finding, { ...finding, key: "src/auth:other-failure", title: "Other failure", line: 3 }] });
  f.state.snapshot.headSha = NEW;
  assert.equal((await f.publisher.submit(await f.create(), { complete: true, conclusion: "follow-up", fixedCommentIds: [f.state.comments[0].id] })).status, "blocked");
  assert.equal(f.state.posts.length, 1);
  for (const kind of ["account", "commit", "body", "link"]) {
    const g = await fixture(t), post = g.github.postReview;
    g.github.postReview = async (...args) => {
      const review = await post(...args);
      if (kind === "account") review.user.id++;
      if (kind === "commit") review.commit_id = NEW;
      if (kind === "body") review.body += "Unexpected text";
      if (kind === "link") review.html_url = "https://evil.example/review";
      return review;
    };
    const id = await g.create();
    assert.equal((await g.publisher.submit(id, clean)).status, "blocked");
    assert.equal((await g.store.read(id))!.uncertain, true);
  }
});
