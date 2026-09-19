import type { Issue } from "../shared/contracts";

export type SortField = "updatedAt" | "createdAt" | "dueDate" | "priority";
export type SortDirection = "newest" | "oldest";
export const issueStatus = (issue: Issue) => issue.status.trim() || "No status";

// Linear's priority scale: 1 = Urgent (most urgent) … 4 = Low; 0/missing = no priority.
// Label forms are accepted too, since Linear returns priorities as either.
const PRIORITY_RANKS: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, urgent: 0, high: 1, medium: 2, low: 3 };
export function priorityRank(priority: string): number {
  const value = priority.trim();
  if (value in PRIORITY_RANKS) return PRIORITY_RANKS[value];
  const label = formatPriority(value).toLowerCase();
  return label in PRIORITY_RANKS ? PRIORITY_RANKS[label] : 4;
}

export function filterIssues(issues: Issue[], query: string, status: string | null, field: SortField, direction: SortDirection) {
  const search = query.trim().toLowerCase();
  return issues.filter((issue) => (!status || issueStatus(issue) === status)
    && [issue.identifier, issue.title, issue.project, issue.team, issue.status, ...issue.labels].join(" ").toLowerCase().includes(search))
    .sort((a, b) => {
      if (field === "priority") {
        const left = priorityRank(a.priority), right = priorityRank(b.priority);
        // Tickets with no priority stay last in either direction.
        if (left === 4) return right === 4 ? 0 : 1;
        if (right === 4) return -1;
        return direction === "newest" ? left - right : right - left;
      }
      const left = Date.parse(a[field] ?? ""), right = Date.parse(b[field] ?? "");
      // Missing dates stay last in either direction; equal dates keep a stable order.
      if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
      if (!Number.isFinite(right)) return -1;
      return direction === "newest" ? right - left : left - right;
    });
}

export function statusCounts(issues: Issue[]) {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issueStatus(issue), (counts.get(issueStatus(issue)) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

/** "Todo → In Progress → Done" from the context snapshot's stateHistory (null when absent). */
export function statusChangesText(context: string): string | null {
  try {
    const parsed = JSON.parse(context);
    const history = parsed && typeof parsed === "object" ? (parsed as { stateHistory?: unknown }).stateHistory : undefined;
    if (!Array.isArray(history)) return null;
    const names = history
      .map((span) => (span && typeof span === "object" ? (span as { state?: unknown }).state : null))
      .filter((name): name is string => typeof name === "string" && Boolean(name));
    return names.length >= 2 ? names.join(" → ") : null;
  } catch { return null; }
}

export function formatIssueDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "No date";
}

// Linear workflows are user-defined, so tone matching stays generic: keywords, not exact names.
export type StatusTone = "done" | "canceled" | "active" | "review" | "backlog" | "neutral";

// WorkflowState.type is an open string set (observed: backlog, unstarted, triage, started,
// completed, duplicate, canceled), so this is a known-value fast path, not a closed enum.
const STATUS_TYPE_TONES: Record<string, StatusTone> = {
  backlog: "backlog",
  unstarted: "backlog",
  triage: "backlog",
  started: "active",
  completed: "done",
  canceled: "canceled",
  duplicate: "canceled",
};

export function statusTone(status: string, statusType = ""): StatusTone {
  const tone = STATUS_TYPE_TONES[statusType.trim().toLowerCase()];
  if (tone) return tone;
  const name = status.trim().toLowerCase();
  if (!name || name === "no status") return "neutral";
  if (/(^|\W)(done|complete|completed|closed|merged|deployed|released|shipped|resolved)(\W|$)/.test(name)) return "done";
  if (/(cancel|declin|duplicate|rejected|abandon|archiv|won'?t)/.test(name)) return "canceled";
  if (/(review|verify|verification|qa|test|approval|approved|staging)/.test(name)) return "review";
  if (/(progress|started|doing|active|working|dev(el)?|implement)/.test(name)) return "active";
  if (/(backlog|icebox|triage|todo|to do|planned|planning|next|ready|queue)/.test(name)) return "backlog";
  return "neutral";
}

export type PriorityTone = "urgent" | "high" | "medium" | "low" | "none";

// Linear returns priorities as labels ("Urgent") or numbers ("1"); normalize both.
const PRIORITY_LABELS: Record<string, string> = { "0": "No priority", "1": "Urgent", "2": "High", "3": "Medium", "4": "Low" };

export function formatPriority(priority: string) {
  const value = priority.trim();
  if (!value) return "No priority";
  return PRIORITY_LABELS[value] ?? value;
}

export function priorityTone(priority: string): PriorityTone {
  const name = formatPriority(priority).toLowerCase();
  if (/(urgent|critical|blocker|p0|asap)/.test(name)) return "urgent";
  if (/(high|important|major|p1)/.test(name)) return "high";
  if (/(medium|normal|moderate|p2)/.test(name)) return "medium";
  if (/(low|minor|trivial|p3)/.test(name)) return "low";
  return "none";
}

/** Priority is only worth a badge when Linear actually set one. */
export const hasPriority = (priority: string) => priorityTone(priority) !== "none";

export function formatRelativeDate(value: string, now: number = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "No date";
  const delta = now - time;
  const future = delta < 0;
  const abs = Math.abs(delta);
  const suffix = future ? "from now" : "ago";
  if (abs < 45_000) return "just now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
  if (abs < 2_592_000_000) return `${Math.round(abs / 86_400_000)}d ${suffix}`;
  return formatIssueDate(value);
}