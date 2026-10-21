import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReviewIntro, reviewIntroMarker, reviewIntroSchema } from "../shared/review-intro";
import { reviewPrompt } from "./launch";

const detail = { repository: "acme/web", number: 42, title: "Fix session expiry", url: "https://github.com/acme/web/pull/42",
  headRef: "fix/session", baseRef: "main", headSha: "a".repeat(40), baseSha: "b".repeat(40) };

test("launch cards retain the full agent message, exact snapshot, and publication instructions", () => {
  const instructions = "Review the complete diff and validate every finding.";
  const publication = "Publish only using the guarded submit_review tool.";
  const message = reviewPrompt(detail, instructions, "Focus on session expiry.", publication);
  const card = parseReviewIntro(message)!;
  assert.ok(card);
  assert.equal(card.message, message);
  assert.ok(message.startsWith(instructions)); assert.ok(message.endsWith(publication));
  assert.ok(message.includes(`git diff ${detail.baseSha}...${detail.headSha}`));
  assert.deepEqual(card.intro, { ...detail, reviewOnly: false, focus: "Focus on session expiry." });
  const draft = parseReviewIntro(reviewPrompt({ ...detail, draft: true }, instructions))!;
  assert.equal(draft.intro.reviewOnly, true);
  assert.equal(draft.intro.focus, "");
});

test("external titles and focus cannot terminate metadata or become rendered markup", () => {
  const title = "Unexpected -->\n<!-- markup -->\u2028Title";
  const data = { ...detail, title, reviewOnly: true, focus: "<script>not executable</script>" };
  const marker = reviewIntroMarker(data);
  assert.equal(marker.split("\n").length, 1);
  assert.ok(!marker.includes("<script>"));
  assert.equal((marker.match(/-->/g) ?? []).length, 1);
  assert.deepEqual(parseReviewIntro(marker)!.intro, data);
  const focus = "🔍".repeat(400);
  const card = parseReviewIntro(reviewPrompt(detail, "Instructions", focus))!;
  assert.equal(Array.from(card.intro.focus).length, 281);
  assert.ok(card.message.includes(focus));
});

test("ordinary messages, malformed metadata, unsupported versions and unsafe links keep the normal renderer", () => {
  for (const message of ["Please review this PR", "<!-- paseo-github-review-intro:v1 {bad JSON} -->", "<!-- paseo-github-review-intro:v1 {} -->", reviewIntroMarker({ ...detail, reviewOnly: false, focus: "" }).replace(":v1", ":v2")]) {
    assert.equal(parseReviewIntro(message), undefined);
  }
  for (const url of ["javascript:alert(1)", "https://github.com.evil.test/acme/web/pull/42", "https://github.com/acme/web/pull/43"]) {
    assert.equal(reviewIntroSchema.safeParse({ ...detail, url, reviewOnly: false, focus: "" }).success, false);
  }
  assert.equal(parseReviewIntro("x".repeat(262_145)), undefined);
});
