import { useContext, useEffect, useState } from "react";
import type { PullRequest } from "../shared/contracts";
import { ReviewOutcomesContext } from "./review-outcomes-provider";
import type { OutcomeState } from "./outcome-poller";
import type { ReviewAgent } from "./review-agents";

export function useReviewOutcomes(pr: PullRequest, agents: ReviewAgent[]) {
  const poller = useContext(ReviewOutcomesContext);
  const [state, setState] = useState<OutcomeState>({ runs: [], error: null });
  const revision = agents.map((agent) => `${agent.id}:${agent.status}`).join(",");
  const enabled = agents.length > 0;
  const active = agents.some((agent) => ["running", "initializing"].includes(agent.status));
  useEffect(() => {
    if (!enabled || !poller) { setState({ runs: [], error: null }); return; }
    return poller.watch({ repository: pr.repository, number: pr.number }, active,
      (next) => setState((previous) => next.error ? { ...previous, error: next.error } : next));
  }, [poller, pr.repository, pr.number, revision, active, enabled]);
  return state;
}
