import type { Issue } from "../shared/contracts";
import { issueStatus, statusTone } from "./issue-list";

// Workflow categories in the order work moves through them; names refine within a category.
const TYPE_RANK: Record<string, number> = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 5, canceled: 6, duplicate: 7 };
const TONE_RANK: Record<string, number> = { backlog: 1.5, active: 3, review: 3.5, done: 5, canceled: 6, neutral: 4 };

export type BoardColumn = { name: string; statusType: string; issues: Issue[]; total: number };

/** Columns for the loaded tickets plus any status the server counted but no loaded page holds yet. */
export function boardColumns(issues: Issue[], countsByName: Record<string, number> | null): BoardColumn[] {
  const columns = new Map<string, BoardColumn>();
  for (const issue of issues) {
    const name = issueStatus(issue);
    const column = columns.get(name) ?? { name, statusType: issue.statusType, issues: [], total: 0 };
    column.issues.push(issue);
    columns.set(name, column);
  }
  for (const [name, count] of Object.entries(countsByName ?? {})) {
    if (!columns.has(name) && count > 0) columns.set(name, { name, statusType: "", issues: [], total: 0 });
  }
  const rank = (column: BoardColumn) => {
    const type = column.statusType.trim().toLowerCase();
    const tone = statusTone(column.name, column.statusType);
    // A review state shares "started" with In Progress; keep it to the right.
    return (TYPE_RANK[type] ?? TONE_RANK[tone] ?? 4) + (tone === "review" ? 0.5 : 0);
  };
  return [...columns.values()]
    .map((column) => ({ ...column, total: Math.max(countsByName?.[column.name] ?? 0, column.issues.length) }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
