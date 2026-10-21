import { reviewOutcomeSchema, reviewSubmissionSchema, prKey, type ReviewFinding, type ReviewSubmission } from "../shared/publication";
import { digest, ReviewStore, type ReviewRun } from "./review-store";
import type { GitHubReviews, GitHubComment, GitHubReview } from "./github";

type GitHub = Pick<GitHubReviews, "identity" | "snapshot" | "reviews" | "comments" | "files" | "postReview" | "reviewComments">;
export const BOT_BADGE = "<sub><sub>![Bot review](https://img.shields.io/badge/Bot%20review-blue?style=flat)</sub></sub>";
function badge(priority: string) { return `<sub><sub>![${priority} Badge](https://img.shields.io/badge/${priority}-${priority === "P1" ? "orange" : "yellow"}?style=flat)</sub></sub>`; }
function fixedIds(review: GitHubReview): number[] {
  return [...(review.body ?? "").matchAll(/<!-- paseo-fixed:([0-9,]+) -->/g)].flatMap((match) => match[1].split(",").map(Number));
}
function sameAccount(a: ReviewRun["reviewer"], b: ReviewRun["reviewer"]) { return a.id === b.id && a.login.toLowerCase() === b.login.toLowerCase(); }
function reviewUrl(run: ReviewRun, review: GitHubReview): string {
  const prefix = `https://github.com/${run.repository}/pull/${run.number}#pullrequestreview-`;
  if (review.html_url.toLowerCase() !== `${prefix}${review.id}`.toLowerCase()) throw new Error("GitHub returned an unexpected review link.");
  return review.html_url;
}
function commentUrl(run: ReviewRun, comment: GitHubComment): string {
  const prefix = `https://github.com/${run.repository}/pull/${run.number}#discussion_r`;
  if (!comment.html_url.toLowerCase().startsWith(prefix.toLowerCase()) || !/^\d+$/.test(comment.html_url.slice(prefix.length))) throw new Error("An original finding link could not be verified.");
  return comment.html_url;
}

// GitHub can omit a truncated patch. Only accept ranges proven to be in one hunk.
export function anchored(finding: ReviewFinding, patch: string | undefined): boolean {
  if (!patch) return false;
  let left = 0, right = 0, hunk = 0;
  const lines = new Map<number, number>();
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) { left = Number(header[1]); right = Number(header[2]); hunk++; continue; }
    if (!hunk || line.startsWith("\\")) continue;
    const kind = line[0];
    if (!["+", "-", " "].includes(kind)) continue;
    if (finding.side === "RIGHT" && kind !== "-") lines.set(right, hunk);
    if (finding.side === "LEFT" && kind !== "+") lines.set(left, hunk);
    if (kind !== "+") left++;
    if (kind !== "-") right++;
  }
  const start = finding.startLine ?? finding.line;
  const group = lines.get(start);
  if (group === undefined) return false;
  for (let line = start; line <= finding.line; line++) if (lines.get(line) !== group) return false;
  return true;
}

export class ReviewPublisher {
  constructor(private readonly github: GitHub, readonly store = new ReviewStore()) {}

  private async verify(run: ReviewRun, review: GitHubReview) {
    if (!sameAccount(run.reviewer, review.user) || review.state.toUpperCase() !== "COMMENTED" || review.commit_id !== run.headSha || !run.requestBody || review.body !== run.requestBody.body || !review.body?.includes(`<!-- paseo-review:${run.headSha}:${run.baseSha}:${run.digest} -->`)) throw new Error("The submitted review's account, commit or content could not be verified.");
    const comments = await this.github.reviewComments(run.repository, run.number, review.id);
    const expected = (run.requestBody?.comments ?? []) as { body: string; path: string; line: number; side: string; start_line?: number }[];
    if (comments.length !== expected.length || expected.some((item) => !comments.some((comment) => sameAccount(run.reviewer, comment.user) && comment.path === item.path && comment.side === item.side && (comment.line ?? comment.original_line) === item.line && (comment.start_line ?? comment.original_start_line ?? comment.line ?? comment.original_line) === (item.start_line ?? item.line) && comment.body === item.body))) throw new Error("The submitted inline findings could not all be verified.");
    const url = reviewUrl(run, review);
    return this.store.update(run.id, (current) => ({ ...current, status: "published", reviewUrl: url, reason: null, uncertain: false }));
  }

  private async recover(run: ReviewRun, reviews: GitHubReview[]) {
    const marker = `<!-- paseo-review:${run.headSha}:${run.baseSha}:${run.digest} -->`;
    const existing = reviews.find((review) => sameAccount(run.reviewer, review.user) && review.commit_id === run.headSha && review.body?.includes(marker));
    if (existing) return this.verify(run, existing);
    if (run.uncertain) throw new Error("A previous GitHub submission has an uncertain outcome. No duplicate will be posted. Inspect GitHub and retry reconciliation later.");
    return null;
  }

  async submit(id: string, raw: unknown) {
    const parsed = reviewSubmissionSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const submission: ReviewSubmission = { ...parsed.data, findings: [...parsed.data.findings].sort((a, b) => a.key.localeCompare(b.key)), fixedCommentIds: [...new Set(parsed.data.fixedCommentIds)].sort((a, b) => a - b) };
    const hash = digest(JSON.stringify(submission));
    const initial = await this.store.read(id);
    if (!initial) throw new Error("This review run is unavailable. Start a new review.");
    const result = await this.store.lock(`publish:${prKey(initial.repository, initial.number)}`, async () => {
      let run = (await this.store.read(id))!;
      if (run.digest && run.digest !== hash && (run.uncertain || run.status === "published")) throw new Error("This run already submitted different content. Start a new review for changed findings.");
      if (run.status === "published") return run;
      try {
        const identity = await this.github.identity();
        if (!sameAccount(identity, run.reviewer)) throw new Error("The active GitHub account changed since this agent was launched. Start a new review with the intended account.");
        const reviews = await this.github.reviews(run.repository, run.number);
        // Reconcile every uncertain attempt under the same PR lock, including
        // earlier processes/runs, before considering another write.
        for (const pending of await this.store.runs(run.repository, run.number)) {
          if (pending.uncertain) await this.recover(pending, reviews);
        }
        run = (await this.store.read(id))!;
        if (run.status === "published") return run;
        run = await this.store.update(id, (current) => ({ ...current, status: "publishing", reason: null, submission, digest: hash }));
        if (!run.requestBody) {
          const previous = (await this.store.runs(run.repository, run.number)).find((item) => item.id !== id && item.digest === hash && item.headSha === run.headSha && item.baseSha === run.baseSha && sameAccount(item.reviewer, run.reviewer) && item.requestBody);
          if (previous) run = await this.store.update(id, (current) => ({ ...current, requestBody: previous.requestBody }));
        }
        const recovered = await this.recover(run, reviews);
        if (recovered) return recovered;
        const snapshot = await this.github.snapshot(run.repository, run.number);
        if (snapshot.state !== "open" || snapshot.draft) throw new Error("Publication is blocked because this PR is closed or a draft.");
        if (snapshot.headSha !== run.headSha || snapshot.baseSha !== run.baseSha) throw new Error("The PR head or base changed after this review started. Run the reviewer again on the current snapshot.");
        if (reviews.some((review) => review.user.id === run.reviewer.id && review.state.toUpperCase() === "PENDING")) throw new Error("A pre-existing pending review prevents publication. It was left unchanged.");
        const comments = await this.github.comments(run.repository, run.number);
        const acknowledged = (comment: GitHubComment) => reviews.some((review) => review.user.id === comment.user.id && review.state.toUpperCase() === "COMMENTED" && (fixedIds(review).includes(comment.id) || (review.body?.startsWith(BOT_BADGE) && review.body.includes("all issues from the previous review have been fixed") && review.body.includes(comment.html_url))));
        const outstanding = comments.filter((comment) => comment.user.id === run.reviewer.id && (/<!-- paseo-finding:[a-f0-9]+:\d+ -->/.test(comment.body) || (comment.body.replace(/^\*\*/, "").startsWith(BOT_BADGE) && /P[12] Badge/.test(comment.body))) && !acknowledged(comment));
        const fixed = submission.fixedCommentIds.map((commentId) => {
          const comment = outstanding.find((item) => item.id === commentId);
          if (!comment) throw new Error("A fixed finding is not an outstanding finding owned by this reviewer.");
          commentUrl(run, comment); return comment;
        });
        if (fixed.length && outstanding.some((comment) => !submission.fixedCommentIds.includes(comment.id))) throw new Error("An all-fixed acknowledgment must cover every outstanding finding. Partial-fix messages are not published.");
        if (submission.conclusion === "clean" && outstanding.some((comment) => !submission.fixedCommentIds.includes(comment.id))) throw new Error("Outstanding prior findings prevent a clean review. Verify the fixes or submit a follow-up result.");
        const fresh: { finding: ReviewFinding; marker: string }[] = [];
        for (const finding of submission.findings) {
          const key = digest(`${prKey(run.repository, run.number)}:${finding.key}`);
          const prior = comments.filter((comment) => sameAccount(comment.user, run.reviewer) && comment.body.includes(`<!-- paseo-finding:${key}:`)).sort((a, b) => b.id - a.id)[0];
          if (prior && !acknowledged(prior)) continue;
          const fixedReview = prior ? reviews.filter((review) => review.user.id === prior.user.id && fixedIds(review).includes(prior.id)).sort((a, b) => b.id - a.id)[0] : null;
          // Exact current-snapshot comments by any author are also duplicates.
          if (comments.some((comment) => comment.path === finding.path && (comment.line ?? comment.original_line) === finding.line && comment.body.trim() === finding.body.trim())) continue;
          fresh.push({ finding, marker: `<!-- paseo-finding:${key}:${fixedReview?.id ?? 0} -->` });
        }
        if ((submission.conclusion === "issues" || (submission.conclusion === "follow-up" && !submission.body)) && !fresh.length && !fixed.length) {
          return this.store.update(id, (current) => ({ ...current, status: "skipped", reason: "No new review content is eligible for publication. Existing findings were left unchanged.", uncertain: false }));
        }
        const files = fresh.length ? await this.github.files(run.repository, run.number) : [];
        for (const { finding } of fresh) if (!anchored(finding, files.find((file) => file.filename === finding.path)?.patch)) throw new Error(`Cannot verify the diff anchor for ${finding.path}:${finding.line}. No review was posted.`);
        const header = `${BOT_BADGE} Reviewed PR at [${run.headSha}](https://github.com/${run.repository}/pull/${run.number}/commits/${run.headSha})`;
        let body = fixed.length ? `${header}: all issues from the previous review have been fixed.\n\nFixed issues:\n\n${fixed.map((comment) => `- ${badge(comment.body.includes("P1 Badge") ? "P1" : "P2")} [Original finding](${commentUrl(run, comment)})`).join("\n")}`
          : submission.conclusion === "clean" ? `${header}: no validated P1/P2 issues found.` : `${header}: ${fresh.length ? "confirmed findings are included inline." : "confirmed P1/P2 issues already reported."}`;
        if (fixed.length && submission.conclusion === "clean") body += "\n\nNo validated P1/P2 issues remain.";
        if (submission.body) body += `\n\n${submission.body}`;
        if (fixed.length) body += `\n\n<!-- paseo-fixed:${fixed.map((comment) => comment.id).join(",")} -->`;
        body += `\n\n<!-- paseo-review:${run.headSha}:${run.baseSha}:${hash} -->\n<!-- paseo-run:${run.id} -->`;
        const requestBody = {
          commit_id: run.headSha, event: "COMMENT", body,
          comments: fresh.map(({ finding, marker }) => ({
            path: finding.path, line: finding.line, side: finding.side,
            ...(finding.startLine !== undefined && finding.startLine < finding.line ? { start_line: finding.startLine, start_side: finding.side } : {}),
            body: `**${BOT_BADGE} ${badge(finding.priority)} ${finding.title}**\n\n${finding.body}\n\n${marker}`,
          })),
        };
        // Last preflight after history and diff reads, immediately before POST.
        const [latest, finalIdentity, latestReviews, latestComments] = await Promise.all([this.github.snapshot(run.repository, run.number), this.github.identity(), this.github.reviews(run.repository, run.number), this.github.comments(run.repository, run.number)]);
        if (!sameAccount(finalIdentity, run.reviewer) || latest.state !== "open" || latest.draft || latest.headSha !== run.headSha || latest.baseSha !== run.baseSha) throw new Error("The GitHub account or PR snapshot changed during publication checks. No review was posted.");
        if (JSON.stringify(latestReviews) !== JSON.stringify(reviews) || JSON.stringify(latestComments) !== JSON.stringify(comments)) throw new Error("The PR review history changed during publication checks. Resubmit to check duplicates against the updated history.");
        run = await this.store.update(id, (current) => ({ ...current, requestBody, uncertain: true }));
        const posted = await this.github.postReview(run.repository, run.number, requestBody);
        return await this.verify(run, posted);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The GitHub review could not be published.";
        return this.store.update(id, (current) => current.status === "published" ? current : { ...current, status: "blocked", reason: message,
          uncertain: (error as { publicationRejected?: boolean })?.publicationRejected === true ? false : current.uncertain });
      }
    });
    return reviewOutcomeSchema.parse(result);
  }
}
