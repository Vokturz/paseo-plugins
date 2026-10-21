import type { ReviewOutcome } from "../shared/publication";
import type { ReviewAgent } from "./review-agents";

export function reviewProgress(agent: ReviewAgent, runs: ReviewOutcome[], currentHead: string | null | undefined) {
  const run = runs.find((item) => item.id === agent.runId || item.agentId === agent.id);
  const active = ["running", "initializing"].includes(agent.status);
  const interrupted = Boolean(run && ["reviewing", "publishing"].includes(run.status) && !active);
  const status = interrupted ? "blocked" : run?.status ?? (active ? "reviewing" : null);
  const head = run?.headSha ?? agent.headSha;
  return {
    status, label: status === "published" ? "Published" : status === "publishing" ? "Publishing…" : status === "blocked" ? "Blocked" : status === "skipped" ? "No new review" : status === "reviewing" ? "Reviewing" : "Outcome unknown",
    reason: interrupted ? "The agent stopped without a verified publication. Open the agent to check or resume the review." : run?.reason ?? null,
    reviewUrl: run?.status === "published" ? run.reviewUrl : null,
    headSha: head, outdated: Boolean(currentHead && head && currentHead.toLowerCase() !== head.toLowerCase()),
  };
}
