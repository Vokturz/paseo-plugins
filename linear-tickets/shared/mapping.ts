// Which Paseo project a Linear ticket opens in. Keys prefer the Linear project and fall
// back to the team, so tickets without a project can still be mapped.
export type ProjectMapping = { projectId: string; baseBranch?: string; label: string };
export type MappingSource = { projectId: string | null; projectName: string; teamId: string | null; teamName: string };
export type MappableProject = { projectId: string; projectCustomName?: string | null; projectDisplayName?: string | null };
export type ResolvedMapping = { projectId: string; baseBranch?: string; reason: "saved" | "name" };

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
export function resolveMapping(source: MappingSource, mappings: Record<string, ProjectMapping>, projects: MappableProject[]): ResolvedMapping | null {
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
