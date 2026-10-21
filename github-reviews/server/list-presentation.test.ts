import assert from "node:assert/strict";
import { test } from "node:test";
import { absoluteTime, relativeTime, searchPage } from "../client/list-presentation";
import type { PullRequest } from "../shared/contracts";

const prs: PullRequest[] = [
  { id: 1, number: 42, title: "Fix session expiry", repository: "acme/web", author: "Octocat", url: "https://github.com/acme/web/pull/42", updatedAt: "2026-10-21T10:00:00Z", draft: false, labels: [] },
  { id: 2, number: 7, title: "Improve worker retries", repository: "acme/api", author: null, url: "https://github.com/acme/api/pull/7", updatedAt: "invalid", draft: true, labels: [] },
];

test("page search matches title, repository, author and PR number without modifying the source page", () => {
  assert.equal(searchPage(prs, "  "), prs);
  for (const query of ["session", "ACME/WEB", "octocat", "@OCTOCAT", "#42", "42", "acme expiry"]) {
    assert.deepEqual(searchPage(prs, query).map((pr) => pr.id), [1]);
  }
  assert.deepEqual(searchPage(prs, "acme").map((pr) => pr.id), [1, 2]);
  assert.deepEqual(searchPage(prs, "@octocat retries"), []);
  assert.deepEqual(searchPage(prs, "outside-this-page"), []);
  assert.equal(prs.length, 2); assert.equal(prs[1].author, null);
});

test("relative timestamps handle unit boundaries, future dates and missing data", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const ago = (seconds: number) => relativeTime(new Date(now - seconds * 1_000).toISOString(), now);
  for (const [seconds, label] of [[0, "just now"], [59, "just now"], [60, "1m ago"], [3_599, "59m ago"], [3_600, "1h ago"], [86_400, "1d ago"], [604_800, "1w ago"], [2_592_000, "1mo ago"], [31_536_000, "1y ago"]] as const) assert.equal(ago(seconds), label);
  assert.equal(relativeTime(new Date(now + 7_200_000).toISOString(), now), "in 2h");
  assert.equal(relativeTime("invalid", now), "Unknown");
  assert.equal(absoluteTime("invalid"), "Unknown");
  assert.notEqual(absoluteTime("2026-10-21T12:00:00Z"), "Unknown");
});
