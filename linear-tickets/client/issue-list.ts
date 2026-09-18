import type { Issue } from "../shared/contracts";

export type DateField = "updatedAt" | "createdAt";
export type DateDirection = "newest" | "oldest";
export const issueStatus = (issue: Issue) => issue.status.trim() || "No status";

export function filterIssues(issues: Issue[], query: string, status: string | null, field: DateField, direction: DateDirection) {
  const search = query.trim().toLowerCase();
  return issues.filter((issue) => (!status || issueStatus(issue) === status)
    && [issue.identifier, issue.title, issue.project, issue.team, issue.status, ...issue.labels].join(" ").toLowerCase().includes(search))
    .sort((a, b) => {
      const left = Date.parse(a[field]), right = Date.parse(b[field]);
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

export function formatIssueDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "No date";
}
