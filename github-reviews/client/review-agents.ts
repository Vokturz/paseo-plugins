import type { PaseoAgent, PaseoAgentUpdate, PaseoApi } from "@getpaseo/client";

export type ReviewAgent = Pick<PaseoAgent, "id" | "title" | "status" | "updatedAt">;
export type ReviewAgentsState = { agents: ReviewAgent[]; loading: boolean; error: string | null };
type Source = Pick<PaseoApi["agents"], "list" | "subscribe">;

// Agent labels are the durable association, shared by every client on the host.
export function watchReviewAgents(source: Source, repository: string, number: number, onChange: (state: ReviewAgentsState) => void) {
  const repo = repository.toLowerCase();
  let agents = new Map<string, ReviewAgent>();
  let updates = new Map<string, PaseoAgentUpdate>();
  let disposed = false, loading = false, reloadRequested = false;
  let error: string | null = null;
  let release: (() => Promise<void>) | undefined;
  let stopOwned: (() => void) | undefined;
  const emit = () => {
    if (!disposed) onChange({ agents: [...agents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)), loading, error });
  };
  const matches = (agent: PaseoAgent) => !agent.archivedAt && agent.labels?.["github.repository"]?.toLowerCase() === repo && agent.labels?.["github.prNumber"] === String(number);
  const apply = (target: Map<string, ReviewAgent>, update: PaseoAgentUpdate) => {
    if (update.kind === "remove") target.delete(update.agentId);
    else if (!matches(update.agent)) target.delete(update.agent.id);
    else target.set(update.agent.id, { id: update.agent.id, title: update.agent.title, status: update.agent.status, updatedAt: update.agent.updatedAt });
  };
  const receive = (update: PaseoAgentUpdate) => {
    if (disposed) return;
    const id = update.kind === "remove" ? update.agentId : update.agent.id;
    if (loading) updates.set(id, update);
    if (!agents.has(id) && (update.kind === "remove" || !matches(update.agent))) return;
    apply(agents, update);
    emit();
  };
  // Scoped removals from another view may just mean an agent left its filter.
  const unsubscribe = source.subscribe((update) => { if (!update.subscriptionId) receive(update); });

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    if (loading) { reloadRequested = true; return; }
    loading = true; error = null; updates = new Map(); emit();
    try {
      const found = new Map<string, ReviewAgent>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const options = {
          filter: { labels: { "github.repository": repo, "github.prNumber": String(number) }, includeArchived: false },
          sort: [{ key: "updated_at" as const, direction: "desc" as const }],
          page: { limit: 100, ...(cursor ? { cursor } : {}) },
        };
        // Own the daemon subscription so archive/create events reach this view.
        const page = await (release ? source.list(options) : source.list({ ...options, subscribe: {} }));
        if (page.subscription) {
          if (disposed) { void page.subscription.release().catch(() => {}); return; }
          release = () => page.subscription!.release();
          let requestId = page.requestId;
          stopOwned = page.subscription.subscribe({
            snapshot: (snapshot) => {
              if (snapshot.requestId !== requestId) { requestId = snapshot.requestId; void refresh(); }
            },
            update: (message) => { if (message.type === "agent_update") receive(message.payload); },
            error: () => {
              error = "Could not load linked review agents. Retry to restore their links.";
              const failed = release; release = undefined;
              stopOwned?.(); stopOwned = undefined;
              if (failed) void failed().catch(() => {});
              emit();
            },
          });
        }
        if (disposed) return;
        for (const { agent } of page.entries) apply(found, { kind: "upsert", agent });
        if (!page.pageInfo.hasMore) break;
        const next = page.pageInfo.nextCursor;
        if (!next || cursors.has(next)) throw new Error("Paseo repeated an agent page.");
        cursors.add(next); cursor = next;
      } while (true);
      // An archive/remove arriving during the read must beat an older snapshot.
      for (const update of updates.values()) apply(found, update);
      agents = found;
    } catch {
      error = "Could not load linked review agents. Retry to restore their links.";
    } finally {
      loading = false; updates.clear(); emit();
      if (reloadRequested && !disposed) { reloadRequested = false; void refresh(); }
    }
  };
  void refresh();
  return {
    refresh,
    dispose: () => { disposed = true; unsubscribe(); stopOwned?.(); if (release) void release().catch(() => {}); },
  };
}
