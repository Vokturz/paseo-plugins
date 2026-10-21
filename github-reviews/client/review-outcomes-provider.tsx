import { useRpc } from "@getpaseo/plugin/client";
import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { batchReviewOutcomesRpc } from "../shared/contracts";
import { OutcomePoller } from "./outcome-poller";

export const ReviewOutcomesContext = createContext<OutcomePoller | null>(null);

export function ReviewOutcomesProvider({ children, revision }: { children: ReactNode; revision?: string }) {
  const fetch = useRpc(batchReviewOutcomesRpc);
  const latestFetch = useRef(fetch);
  latestFetch.current = fetch;
  const [poller] = useState(() => new OutcomePoller((input) => latestFetch.current(input)));
  useEffect(() => { if (revision) poller.refresh(); }, [poller, revision]);
  useEffect(() => {
    const active = () => AppState.currentState !== "background" && AppState.currentState !== "inactive";
    poller.setForeground(active());
    const timer = setInterval(() => { if (active()) poller.poll(); }, 10_000);
    const subscription = AppState.addEventListener("change", () => poller.setForeground(active()));
    return () => { clearInterval(timer); subscription.remove(); poller.setForeground(false); };
  }, [poller]);
  return <ReviewOutcomesContext.Provider value={poller}>{children}</ReviewOutcomesContext.Provider>;
}
