import type { Issue, IssueLabel, LabelRef, ListFilter } from "../shared/contracts";

export type WorkspaceLabel = IssueLabel & { team?: string };
export type LabelOption = { id: string; label: string; description?: string; ref: LabelRef };
export type LabelChipData = { label: string; color?: string; grouped: boolean };

export const labelDisplay = (item: { name: string; groupName?: string }) => item.groupName ? `${item.groupName} / ${item.name}` : item.name;
export const labelRefKey = (ref: LabelRef) => `${ref.group}\u0000${ref.name}`;
export const labelRefDisplay = (ref: LabelRef) => ref.group ? `${ref.group} / ${ref.name}` : ref.name;

// Linear colors are hex strings; anything else is ignored rather than passed to styles.
export function safeColor(value: string | undefined): string | undefined {
  return value && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : undefined;
}

// Labels that share a group and name across teams filter as one option.
export function labelFilterOptions(labels: WorkspaceLabel[]): LabelOption[] {
  const options = new Map<string, LabelOption & { teams: Set<string> }>();
  for (const item of labels) {
    const ref = { group: item.groupName, name: item.name };
    const key = labelRefKey(ref);
    const option = options.get(key) ?? { id: key, label: labelDisplay(item), ref, teams: new Set<string>() };
    option.teams.add(item.team || "Workspace");
    options.set(key, option);
  }
  return [...options.values()]
    .map(({ teams, ...option }) => ({ ...option, description: [...teams].sort().join(", ") }))
    .sort((a, b) => (a.ref.group ? 0 : 1) - (b.ref.group ? 0 : 1) || a.label.localeCompare(b.label));
}

export function labelGroupNames(labels: WorkspaceLabel[]): string[] {
  return [...new Set(labels.map((item) => item.groupName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// Grouped labels first (they usually answer "where" and "what kind"), then the rest.
export function issueLabelChips(issue: Pick<Issue, "labels" | "labelInfo">): LabelChipData[] {
  if (issue.labelInfo?.length) {
    return [...issue.labelInfo]
      .sort((a, b) => (a.groupName ? 0 : 1) - (b.groupName ? 0 : 1) || a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name))
      .map((item) => ({ label: labelDisplay(item), color: safeColor(item.color), grouped: Boolean(item.groupName) }));
  }
  return issue.labels.map((label) => ({ label, grouped: label.includes(" / ") }));
}

export function activeFilterCount(filter: ListFilter): number {
  return filter.labels.length + filter.missingGroups.length + filter.customerIds.length + (filter.anyCustomer ? 1 : 0);
}

export function toggleLabel(filter: ListFilter, ref: LabelRef): ListFilter {
  const key = labelRefKey(ref);
  const exists = filter.labels.some((item) => labelRefKey(item) === key);
  return { ...filter, labels: exists ? filter.labels.filter((item) => labelRefKey(item) !== key) : [...filter.labels, ref] };
}

export function toggleMissingGroup(filter: ListFilter, group: string): ListFilter {
  return { ...filter, missingGroups: filter.missingGroups.includes(group) ? filter.missingGroups.filter((item) => item !== group) : [...filter.missingGroups, group] };
}

export function toggleCustomer(filter: ListFilter, id: string): ListFilter {
  return { ...filter, anyCustomer: false, customerIds: filter.customerIds.includes(id) ? filter.customerIds.filter((item) => item !== id) : [...filter.customerIds, id] };
}

// Quick label chips above the list: active label filters first, then the labels most common
// among the loaded tickets, so one tap narrows the view the way a board's label bar does.
export function quickLabels(issues: Pick<Issue, "labelInfo">[], active: LabelRef[], limit = 8): { ref: LabelRef; color?: string; count: number }[] {
  const seen = new Map<string, { ref: LabelRef; color?: string; count: number }>();
  for (const issue of issues) {
    for (const item of issue.labelInfo ?? []) {
      const ref = { group: item.groupName, name: item.name };
      const key = labelRefKey(ref);
      const entry = seen.get(key) ?? { ref, color: safeColor(item.color), count: 0 };
      entry.count++;
      seen.set(key, entry);
    }
  }
  const activeKeys = new Set(active.map(labelRefKey));
  const chosen = active.map((ref) => seen.get(labelRefKey(ref)) ?? { ref, count: 0 });
  const common = [...seen.values()].filter((entry) => !activeKeys.has(labelRefKey(entry.ref)))
    .sort((a, b) => b.count - a.count || labelRefDisplay(a.ref).localeCompare(labelRefDisplay(b.ref)));
  return [...chosen, ...common.slice(0, Math.max(0, limit - chosen.length))];
}
