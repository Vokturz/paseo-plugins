import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { reviewOutcomesRpc, type PullRequest } from "../shared/contracts";
import type { ReviewOutcome } from "../shared/publication";

export function useReviewOutcomes(pr: PullRequest, revision: string) {
  const get = useRpc(reviewOutcomesRpc);
  const [runs, setRuns] = useState<ReviewOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    try {
      const result = await get({ repository: pr.repository, number: pr.number });
      if (current === generation.current) { setRuns(result.runs); setError(null); }
    } catch { if (current === generation.current) setError("Review publication status is unavailable. Open the agent for details."); }
    finally { if (current === generation.current) busy.current = false; }
  }, [get, pr.repository, pr.number]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => { if (AppState.currentState !== "background" && AppState.currentState !== "inactive") void reload(); }, 10_000);
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active") void reload(); });
    return () => { clearInterval(timer); foreground.remove(); generation.current++; busy.current = false; };
  }, [reload, revision]);
  return { runs, error };
}
