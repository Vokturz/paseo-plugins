// Which Paseo project a Linear ticket opens in. A label mapping (for example a label that
// names the part of the system, such as "Area / Core API") is the most specific signal and
// is checked first; then the Linear project, then the team, so tickets without a project
// can still be mapped. Label mappings are configured in Settings; project and team
// mappings are remembered from launches.
export type ProjectMapping = { projectId: string; baseBranch?: string; label: string };
export type MappingSource = { projectId: string | null; projectName: string; teamId: string | null; teamName: string; labels?: { id: string; name: string; groupName?: string }[] };
export type MappableProject = { projectId: string; projectCustomName?: string | null; projectDisplayName?: string | null };
export type ResolvedMapping = { projectId: string; baseBranch?: string; reason: "label" | "saved" | "name" | "recent"; labels?: string[] };

export const labelMappingKey = (labelId: string) => `label:${labelId}`;

export const MAX_PROJECT_MAPPINGS = 200;

export function mappingKey(source: MappingSource): string | null {
  if (source.projectId) return `project:${source.projectId}`;
  if (source.teamId) return `team:${source.teamId}`;
  return null;
}

export function mappingLabel(source: MappingSource): string {
  return source.projectId ? source.projectName || "Linear project" : `${source.teamName || "Linear team"} (no project)`;
}

function projectName(project: MappableProject): string {
  return (project.projectCustomName || project.projectDisplayName || "").trim().toLowerCase();
}

// A saved mapping wins while its project still exists; otherwise only a unique,
// case-insensitive name match preselects, so a collision never guesses.
// Label mappings decide only when every mapped label on the ticket points at the same
// project and branch; conflicting labels fall through to the project and team mappings.
export function labelMappingConflict(source: MappingSource, mappings: Record<string, ProjectMapping>, projects: MappableProject[]): { projectId: string; baseBranch?: string; labels: string[] }[] {
  const targets = new Map<string, { projectId: string; baseBranch?: string; labels: string[] }>();
  for (const item of source.labels ?? []) {
    const saved = mappings[labelMappingKey(item.id)];
    if (!saved || !projects.some((project) => project.projectId === saved.projectId)) continue;
    const key = `${saved.projectId}\u0000${saved.baseBranch ?? ""}`;
    const target = targets.get(key) ?? { projectId: saved.projectId, ...(saved.baseBranch ? { baseBranch: saved.baseBranch } : {}), labels: [] };
    target.labels.push(item.groupName ? `${item.groupName} / ${item.name}` : item.name);
    targets.set(key, target);
  }
  return [...targets.values()];
}

// Without any mapping or name match, the most recently used project is preselected.
export function resolveMapping(source: MappingSource, mappings: Record<string, ProjectMapping>, projects: MappableProject[], recent?: { projectId: string; baseBranch?: string } | null): ResolvedMapping | null {
  const resolved = resolveMapped(source, mappings, projects);
  if (resolved) return resolved;
  if (recent && projects.some((project) => project.projectId === recent.projectId)) {
    return { projectId: recent.projectId, ...(recent.baseBranch ? { baseBranch: recent.baseBranch } : {}), reason: "recent" };
  }
  return null;
}

function resolveMapped(source: MappingSource, mappings: Record<string, ProjectMapping>, projects: MappableProject[]): ResolvedMapping | null {
  const byLabel = labelMappingConflict(source, mappings, projects);
  if (byLabel.length === 1) {
    const [target] = byLabel;
    return { projectId: target.projectId, ...(target.baseBranch ? { baseBranch: target.baseBranch } : {}), reason: "label", labels: target.labels };
  }
  const key = mappingKey(source);
  const saved = key ? mappings[key] : undefined;
  if (saved && projects.some((project) => project.projectId === saved.projectId)) {
    return { projectId: saved.projectId, ...(saved.baseBranch ? { baseBranch: saved.baseBranch } : {}), reason: "saved" };
  }
  const wanted = source.projectName.trim().toLowerCase();
  if (!source.projectId || !wanted) return null;
  const matches = projects.filter((project) => projectName(project) === wanted);
  return matches.length === 1 ? { projectId: matches[0].projectId, reason: "name" } : null;
}

// The branch a ticket starts from once its project's branches are loaded: the saved
// branch while it still exists, otherwise the repo default, never the previous ticket's.
export function mappedBaseBranch(saved: string | undefined, branches: { id: string }[], defaultBranch: string | null): string {
  return saved && branches.some((branch) => branch.id === saved) ? saved : defaultBranch ?? "";
}
