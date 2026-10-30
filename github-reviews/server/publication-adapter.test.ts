import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GitHubReviews, type GitHubComment, type GitHubReview, type RunGh } from "./github";
import { ReviewPublisher } from "./publication";
import { ReviewStore, runSchema } from "./review-store";

const HEAD = "a".repeat(40), BASE = "b".repeat(40);
const USER = { id: 7, login: "reviewer" };
const REVIEW_URL = "https://github.com/acme/web/pull/42#pullrequestreview-100";
const submission = {
  complete: true, conclusion: "issues",
  findings: [
    { key: "auth:expired-session", priority: "P2", title: "Reject expired sessions", body: "Expired credentials still grant access.", path: "src/auth.ts", side: "RIGHT", startLine: 715, line: 716 },
    { key: "auth:missing-session", priority: "P1", title: "Reject missing sessions", body: "Missing credentials still grant access.", path: "src/auth.ts", side: "LEFT", line: 712 },
  ],
};

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const home = await mkdtemp(join(tmpdir(), "publication-adapter-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new ReviewStore(home), id = randomUUID();
  await store.create(runSchema.parse({ version: 1, id, agentId: id, repository: "acme/web", number: 42, headSha: HEAD, baseSha: BASE,
    reviewer: USER, status: "reviewing", reason: null, reviewUrl: null, updatedAt: new Date().toISOString() }));
  const state = {
    review: null as GitHubReview | null, postedComments: [] as GitHubComment[], posts: 0,
    calls: [] as { method: string; endpoint: string; page: number }[],
    verificationError: null as Error | null,
    alter: (_comments: GitHubComment[]) => {},
  };
  const legacyComments = () => state.postedComments.map((comment) => ({
    id: comment.id, html_url: comment.html_url, user: comment.user, body: comment.body,
    path: comment.path, pull_request_review_id: comment.pull_request_review_id,
    // Review-specific responses supply position/diff_hunk, but omit the anchors.
    position: 7, diff_hunk: "@@ -710,7 +710,7 @@",
  }));
  const run: RunGh = async (args, input) => {
    const method = args[4], endpoint = args[5];
    const page = Number(args.find((arg) => arg.startsWith("page="))?.slice(5) ?? 1);
    state.calls.push({ method, endpoint, page });
    let response: unknown;
    if (endpoint === "user") response = USER;
    else if (endpoint === "repos/acme/web/pulls/42") response = {
      number: 42, title: "Fix auth", state: "open", draft: false, html_url: "https://github.com/acme/web/pull/42",
      base: { sha: BASE, ref: "main", repo: { full_name: "acme/web" } }, head: { sha: HEAD, ref: "fix" },
    };
    else if (endpoint.endsWith("/reviews") && method === "POST") {
      state.posts++;
      const body = JSON.parse(input!);
      state.review = { id: 100, html_url: REVIEW_URL, state: "COMMENTED", body: body.body, commit_id: HEAD, user: USER };
      // Only text comes from the submission; anchors are independent API fixtures.
      // In particular, never spread submitted comment fields into responses.
      state.postedComments = [
        { id: 1000, html_url: "https://github.com/acme/web/pull/42#discussion_r1000", user: USER, pull_request_review_id: 100,
          body: body.comments[0].body, path: "src/auth.ts", line: 716, original_line: 716, side: "RIGHT", start_line: 715, original_start_line: 715 },
        { id: 1001, html_url: "https://github.com/acme/web/pull/42#discussion_r1001", user: USER, pull_request_review_id: 100,
          body: body.comments[1].body, path: "src/auth.ts", line: null, original_line: 712, side: "LEFT", start_line: null, original_start_line: null },
      ];
      response = state.review;
    }
    else if (endpoint.endsWith("/reviews")) response = state.review ? [state.review] : [];
    else if (endpoint.endsWith("/reviews/100/comments")) response = legacyComments();
    else if (endpoint === "repos/acme/web/pulls/42/comments") {
      assert.ok(args.includes("per_page=100"));
      if (state.review && state.verificationError) throw state.verificationError;
      const comments = structuredClone(state.postedComments);
      if (state.review) state.alter(comments);
      // A full first page with no matching review must not end pagination.
      // Other reviews may even contain identical text and anchors.
      response = page === 1 ? Array.from({ length: 100 }, (_, index) => ({
        ...comments[0], id: 2000 + index, html_url: `https://github.com/acme/web/pull/42#discussion_r${2000 + index}`,
        user: USER, body: comments[0]?.body ?? "A previous comment.", path: "src/auth.ts",
        pull_request_review_id: index === 0 ? undefined : 99,
      })) : comments;
    }
    else if (endpoint.endsWith("/files")) response = [{ filename: "src/auth.ts", patch: "@@ -710,7 +710,7 @@\n context\n context\n context\n context\n context\n context\n context" }];
    else throw new Error(`Unexpected GitHub request: ${method} ${endpoint}`);
    return JSON.stringify(response);
  };
  const github = new GitHubReviews(run);
  return { id, state, store, home, github, run, legacyComments, publisher: new ReviewPublisher(github, store) };
}

test("adapter verifies multiline and original anchors using every PR comment page, filtered by exact review ID", async (t) => {
  const f = await fixture(t);
  const result = await f.publisher.submit(f.id, submission);
  assert.equal(result.status, "published");
  assert.equal(result.reviewUrl, REVIEW_URL);
  assert.equal((await f.store.read(f.id))!.uncertain, false);
  assert.equal(f.state.posts, 1);
  assert.equal(f.state.calls.some((call) => call.endpoint.includes("/reviews/100/comments")), false);
  assert.deepEqual(f.state.calls.filter((call) => call.endpoint.endsWith("/comments")).map((call) => call.page), [1, 2, 1, 2, 1, 2]);
  assert.equal("line" in f.legacyComments()[0], false);
  assert.equal("side" in f.legacyComments()[0], false);
});

test("reconciles a persisted legacy blocked/uncertain run after restart with zero additional POSTs", async (t) => {
  const f = await fixture(t);
  // Emulate the old adapter against a realistic review-specific response.
  f.github.reviewComments = async () => f.legacyComments();
  const pending = await f.publisher.submit(f.id, submission);
  assert.equal(pending.status, "verifying");
  await f.store.update(f.id, (run) => ({ ...run, status: "blocked", uncertain: true, reviewUrl: null,
    reason: "The submitted inline findings could not all be verified." }));
  const posts = f.state.posts;
  const restarted = new ReviewPublisher(new GitHubReviews(f.run), new ReviewStore(f.home));
  const result = await restarted.submit(f.id, submission);
  assert.equal(result.status, "published");
  assert.equal(result.reviewUrl, REVIEW_URL);
  assert.equal(result.reason, null);
  assert.equal((await f.store.read(f.id))!.uncertain, false);
  assert.equal(f.state.posts - posts, 0);
});

test("adapter-to-publisher verification rejects mismatched accounts, text, anchors, membership and counts", async (t) => {
  const changes: Record<string, (comments: GitHubComment[]) => void> = {
    "account ID": (comments) => { comments[0].user.id++; },
    "account login": (comments) => { comments[0].user.login = "other"; },
    body: (comments) => { comments[0].body += "Unexpected text"; },
    path: (comments) => { comments[0].path = "src/other.ts"; },
    line: (comments) => { comments[0].line = 717; },
    "original line": (comments) => { comments[1].original_line = 713; },
    side: (comments) => { comments[0].side = "LEFT"; },
    range: (comments) => { comments[0].start_line = 714; },
    "original range": (comments) => { comments[0].start_line = null; comments[0].original_start_line = 714; },
    "missing anchors": (comments) => { delete comments[0].line; delete comments[0].original_line; delete comments[0].side; },
    "different review": (comments) => { comments[0].pull_request_review_id = 99; },
    "missing review ID": (comments) => { delete comments[0].pull_request_review_id; },
    "missing comment": (comments) => { comments.pop(); },
    "extra comment": (comments) => { comments.push({ ...comments[0], id: 1002 }); },
  };
  for (const [name, alter] of Object.entries(changes)) await t.test(name, async (t) => {
    const f = await fixture(t);
    f.state.alter = alter;
    const result = await f.publisher.submit(f.id, submission);
    assert.equal(result.status, "verifying");
    assert.equal(result.reviewUrl, REVIEW_URL);
    assert.match(result.reason!, /inline findings could not all be verified/);
    assert.equal((await f.store.read(f.id))!.uncertain, true);
    await f.publisher.submit(f.id, submission);
    assert.equal(f.state.posts, 1);
  });
});

test("a rejected verification GET retains the accepted review link and prevents another POST", async (t) => {
  const f = await fixture(t);
  f.state.verificationError = Object.assign(new Error("GitHub denied access."), { publicationRejected: true });
  const pending = await f.publisher.submit(f.id, submission);
  assert.equal(pending.status, "verifying");
  assert.equal(pending.reviewUrl, REVIEW_URL);
  assert.match(pending.reason!, /GitHub accepted the review; verification is pending/);
  assert.equal((await f.store.read(f.id))!.uncertain, true);
  assert.equal((await f.publisher.submit(f.id, submission)).status, "verifying");
  assert.equal(f.state.posts, 1);
  f.state.verificationError = null;
  assert.equal((await f.publisher.submit(f.id, submission)).status, "published");
  assert.equal(f.state.posts, 1);
});
