import type { ReviewAgent } from "./review-agents";
import { reviewProgress } from "./review-outcomes";
import type { ReviewOutcome } from "../shared/publication";

export type ReviewPrimaryAction =
  | { kind: "starting" | "checking" | "retry-status" | "start" | "choose-project" | "configure" | "open-pr"; label: string }
  | { kind: "open-agent"; label: string; agentId: string }
  | { kind: "view-review"; label: string; url: string };

export function reviewPrimaryAction(input: {
  agents: ReviewAgent[]; runs: ReviewOutcome[]; currentHead?: string | null;
  busy: boolean; loading: boolean; failed?: boolean; createdAgentId?: string; configured: boolean;
  canLaunch: boolean; projectId: string; draft: boolean;
}): ReviewPrimaryAction {
  if (input.busy) return { kind: "starting", label: "Starting review…" };
  // Prioritize any active run, even if a newer historical agent is idle.
  const active = input.agents.find((agent) => ["running", "initializing"].includes(agent.status));
  if (active) return { kind: "open-agent", label: "Open agent", agentId: active.id };
  if (input.createdAgentId && !input.agents.some((agent) => agent.id === input.createdAgentId)) {
    return { kind: "open-agent", label: "Open agent", agentId: input.createdAgentId };
  }
  const latest = input.agents[0];
  if (latest) {
    const progress = reviewProgress(latest, input.runs, input.currentHead);
    if (progress.reviewUrl) return { kind: "view-review", label: "View review", url: progress.reviewUrl };
    return { kind: "open-agent", label: "Open agent", agentId: latest.id };
  }
  if (input.failed) return { kind: "retry-status", label: "Retry status" };
  if (input.loading) return { kind: "checking", label: "Checking reviews…" };
  if (!input.canLaunch) return { kind: "open-pr", label: "Open on GitHub" };
  if (!input.configured) return { kind: "configure", label: "Configure reviewer" };
  if (!input.projectId) return { kind: "choose-project", label: "Choose project" };
  return { kind: "start", label: input.draft ? "Review draft locally" : "Start review" };
}
