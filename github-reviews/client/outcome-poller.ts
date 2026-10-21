import { PAGE_SIZE } from "../shared/contracts";
import { prKey, type ReviewOutcome } from "../shared/publication";

type Target = { repository: string; number: number };
export type OutcomeState = { runs: ReviewOutcome[]; error: string | null };
export type FetchOutcomes = (input: { targets: Target[] }) => Promise<{ runsByPr: Record<string, ReviewOutcome[]>; failedTargets: string[] }>;
type Entry = { target: Target; active: boolean; state: OutcomeState; lastAttempt: number; listener: (state: OutcomeState) => void };
const unavailable = "Review publication status is unavailable. Open the agent for details.";

// One coordinator per surface batches row subscriptions and owns their polling cadence.
export class OutcomePoller {
  private entries = new Map<string, Entry>();
  private dirty = new Set<string>();
  private queued = false;
  private busy = false;
  private foreground = true;
  constructor(private readonly fetch: FetchOutcomes, private readonly now = Date.now) {}

  watch(target: Target, active: boolean, listener: Entry["listener"]) {
    const key = prKey(target.repository, target.number);
    const entry: Entry = { target, active, state: { runs: [], error: null }, lastAttempt: -Infinity, listener };
    this.entries.set(key, entry);
    this.dirty.add(key); this.schedule();
    return () => { if (this.entries.get(key) === entry) { this.entries.delete(key); this.dirty.delete(key); } };
  }
  setForeground(active: boolean) {
    this.foreground = active;
    if (active) this.refresh();
  }
  refresh() {
    for (const key of this.entries.keys()) this.dirty.add(key);
    this.schedule();
  }
  poll() {
    for (const [key, entry] of this.entries) {
      const active = entry.active || entry.state.runs.some((run) => run.status === "publishing");
      if (this.now() - entry.lastAttempt >= (active ? 10_000 : 60_000)) this.dirty.add(key);
    }
    this.schedule();
  }
  private schedule() {
    if (this.queued || this.busy || !this.foreground || !this.dirty.size) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; void this.flush(); });
  }
  async flush(): Promise<void> {
    if (this.busy || !this.foreground) return;
    this.busy = true;
    try {
      while (this.foreground && this.dirty.size) {
        const batch = [...this.dirty].slice(0, PAGE_SIZE).flatMap((key) => {
          this.dirty.delete(key);
          const entry = this.entries.get(key);
          return entry ? [{ key, entry }] : [];
        });
        if (!batch.length) continue;
        for (const { entry } of batch) entry.lastAttempt = this.now();
        let result: Awaited<ReturnType<FetchOutcomes>> | null = null;
        try { result = await this.fetch({ targets: batch.map(({ entry }) => entry.target) }); } catch { /* Preserve each row's last successful status. */ }
        for (const { key, entry } of batch) {
          if (this.entries.get(key) !== entry) continue;
          const runs = result?.runsByPr[key];
          entry.state = result && !result.failedTargets.includes(key) && runs
            ? { runs, error: null } : { ...entry.state, error: unavailable };
          entry.listener(entry.state);
        }
      }
    } finally { this.busy = false; this.schedule(); }
  }
}
