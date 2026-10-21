import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { POLL_INTERVAL_MS, type PullRequest } from "../shared/contracts";
import { watchReviewAgents, type ReviewAgentsState } from "./review-agents";

export function useReviewAgents(pr: PullRequest, createdAgentId?: string) {
  const paseo = usePaseo();
  const [state, setState] = useState<ReviewAgentsState>({ agents: [], loading: true, error: null });
  const [syncedAgentId, setSyncedAgentId] = useState<string | undefined>();
  const watcher = useRef<ReturnType<typeof watchReviewAgents> | null>(null);
  useEffect(() => {
    const current = watchReviewAgents(paseo.agents, pr.repository, pr.number, setState);
    watcher.current = current;
    const timer = setInterval(() => {
      if (AppState.currentState !== "background" && AppState.currentState !== "inactive") void current.refresh();
    }, POLL_INTERVAL_MS);
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active") void current.refresh(); });
    return () => { clearInterval(timer); foreground.remove(); current.dispose(); watcher.current = null; };
  }, [paseo, pr.repository, pr.number]);
  useEffect(() => {
    if (!createdAgentId) return;
    let current = true;
    void watcher.current?.refresh().finally(() => { if (current) setSyncedAgentId(createdAgentId); });
    return () => { current = false; };
  }, [createdAgentId, paseo, pr.repository, pr.number]);
  return { ...state, pendingCreatedAgentId: createdAgentId !== syncedAgentId ? createdAgentId : undefined, refresh: () => watcher.current?.refresh() };
}
