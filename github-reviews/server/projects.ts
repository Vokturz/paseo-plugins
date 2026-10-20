import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import type { LocalProject, ProjectMatches } from "../shared/projects";

const execute = promisify(execFile);
type ProjectSource = Pick<PaseoApi, "projects">;
export type ReadRepositories = (path: string) => Promise<string[]>;

export function githubRepository(remote: string): string | null {
  const value = remote.trim();
  const scp = /^(?:[^/@\s]+@)?(?:github\.com|ssh\.github\.com):(.+)$/i.exec(value);
  let path: string;
  if (scp) path = scp[1];
  else {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
    if (url.hostname.toLowerCase() !== "github.com" && !(url.protocol === "ssh:" && url.hostname.toLowerCase() === "ssh.github.com")) return null;
    if (url.search || url.hash) return null;
    path = url.pathname;
  }
  const repository = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return /^[a-z0-9_-]+\/[a-z0-9_.-]+$/i.test(repository) ? repository.toLowerCase() : null;
}

export const readGitRepositories: ReadRepositories = async (path) => {
  let output: string;
  try {
    const result = await execute("git", ["-C", path, "config", "--local", "--get-regexp", "^remote\\..*\\.url$"], {
      timeout: 3_000, killSignal: "SIGKILL", maxBuffer: 512 * 1024, encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    output = result.stdout;
  } catch (error) {
    // git config exits 1 when no matching remote entries exist.
    if ((error as { code?: number }).code === 1) return [];
    throw new Error("Could not inspect the local project's Git remotes.");
  }
  const repositories = output.split("\n").flatMap((line) => {
    const value = /^\S+\s+(.+)$/.exec(line)?.[1];
    const repository = value ? githubRepository(value) : null;
    return repository ? [repository] : [];
  });
  return [...new Set(repositories)];
};

export async function matchRepositoryProjects(paseo: ProjectSource, repositories: string[], read: ReadRepositories = readGitRepositories): Promise<ProjectMatches> {
  const wanted = [...new Set(repositories.map((repository) => repository.toLowerCase()))];
  if (!wanted.length) return { projectsByRepository: {}, projectWarning: null };
  const matches = new Map(wanted.map((repository) => [repository, new Map<string, LocalProject>()]));
  let incomplete = false;
  try {
    const { projects } = await paseo.projects.list();
    const gitProjects = projects.filter((project) => project.projectKind === "git");
    let position = 0;
    const deadline = Date.now() + 5_000;
    await Promise.all(Array.from({ length: Math.min(4, gitProjects.length) }, async () => {
      while (position < gitProjects.length) {
        if (Date.now() >= deadline) { incomplete = true; return; }
        const project = gitProjects[position++];
        try {
          const remotes = await read(project.projectRootPath);
          for (const repository of remotes) matches.get(repository)?.set(project.projectId, {
            projectId: project.projectId,
            name: project.projectCustomName?.trim() || project.projectDisplayName?.trim() || basename(project.projectRootPath),
            path: project.projectRootPath,
          });
        } catch { incomplete = true; }
      }
    }));
  } catch { incomplete = true; }
  return {
    projectsByRepository: Object.fromEntries([...matches].map(([repository, projects]) => {
      const sorted = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
      return [repository, { status: sorted.length ? "available" : incomplete ? "unknown" : "missing", projects: sorted }];
    })),
    projectWarning: incomplete ? "Some local projects could not be checked. Refresh to try again." : null,
  };
}
