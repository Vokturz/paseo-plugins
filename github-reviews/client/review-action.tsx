import { useRpc } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { launchReviewRpc, type LaunchReviewResult, type PullRequest } from "../shared/contracts";

type LaunchState = { requestId: string; instructions: string; busy: boolean; result?: LaunchReviewResult; error?: string };
function requestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 3) | 8).toString(16);
  });
}

// Keep request IDs and outcomes across pagination, refreshes, and tab changes.
export function useReviewLaunch() {
  const launch = useRpc(launchReviewRpc);
  const states = useRef(new Map<string, LaunchState>());
  const drafts = useRef(new Map<string, string>());
  const [, render] = useState(0);
  const draftKey = (pr: PullRequest) => JSON.stringify([pr.repository, pr.number]);
  const key = (pr: PullRequest, projectId: string) => JSON.stringify([pr.repository, pr.number, projectId]);
  return {
    instructions: (pr: PullRequest) => drafts.current.get(draftKey(pr)) ?? "",
    setInstructions: (pr: PullRequest, value: string) => {
      drafts.current.set(draftKey(pr), value);
      render((value) => value + 1);
    },
    state: (pr: PullRequest, projectId: string) => states.current.get(key(pr, projectId)),
    start: async (pr: PullRequest, projectId: string) => {
      const id = key(pr, projectId);
      const prior = states.current.get(id);
      if (prior?.busy) return;
      const instructions = (drafts.current.get(draftKey(pr)) ?? "").trim();
      // A retry reuses its ID; an intentional run after success gets a new ID.
      // Preserve the last agent so it remains accessible if a new run fails.
      const state: LaunchState = {
        requestId: prior && prior.instructions === instructions && (prior.error || !prior.result) ? prior.requestId : requestId(),
        instructions, busy: true, result: prior?.result,
      };
      states.current.set(id, state);
      render((value) => value + 1);
      try {
        state.result = await launch({ repository: pr.repository, number: pr.number, projectId, requestId: state.requestId, instructions });
      } catch (error) {
        state.error = error instanceof Error ? error.message : "Could not start the review. Try again.";
      } finally {
        state.busy = false;
        render((value) => value + 1);
      }
    },
  };
}
