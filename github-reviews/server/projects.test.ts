import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PaseoApi } from "@getpaseo/client";
import { githubRepository, matchRepositoryProjects, readGitRepositories } from "./projects";

type Source = Parameters<typeof matchRepositoryProjects>[0];
type Project = Awaited<ReturnType<PaseoApi["projects"]["list"]>>["projects"][number];
function project(projectId: string, path: string, extra: Partial<Project> = {}): Project {
  return { projectId, projectRootPath: path, projectDisplayName: "Repository", projectKind: "git", ...extra };
}
function source(projects: Project[]): Source {
  return { projects: { list: async () => ({ requestId: "test", projects }) } } as Source;
}

test("matches GitHub SSH/HTTPS remotes case-insensitively without exposing embedded credentials", () => {
  for (const url of [
    "git@github.com:Acme/Web.git", "https://github.com/Acme/Web.git", "https://github.com/Acme/Web/",
    "ssh://git@github.com/Acme/Web.git", "ssh://git@ssh.github.com:443/Acme/Web.git",
    "git://github.com/Acme/Web.git", "https://secret-token@github.com/Acme/Web.git",
    "github.com:Acme/Web.git",
  ]) assert.equal(githubRepository(url), "acme/web");
  for (const url of [
    "https://gitlab.com/acme/web.git", "git@github.com.evil.test:acme/web.git", "/local/repo.git",
    "https://github.com/acme/web/pull/1", "https://github.com/acme/web?query=other", "git@github-work:acme/web.git", "not a remote",
  ]) assert.equal(githubRepository(url), null);
});

test("read-only Git discovery handles renamed checkouts, multiple remotes, worktrees and missing remotes", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-github-projects-"));
  const repo = join(root, "renamed-checkout");
  const worktree = join(root, "isolated-worktree");
  const execute = promisify(execFile);
  const git = (args: string[]) => execute("git", ["-C", repo, ...args]);
  try {
    await execute("git", ["init", "--initial-branch=main", repo]);
    assert.deepEqual(await readGitRepositories(repo), []);
    await git(["remote", "add", "origin", "git@github.com:fork/Web.git"]);
    await git(["remote", "add", "upstream", "https://github.com/acme/Web.git"]);
    await git(["remote", "add", "mirror", "https://github.com/acme/Web.git"]);
    await git(["remote", "add", "other-host", "https://gitlab.com/elsewhere/Web.git"]);
    assert.deepEqual((await readGitRepositories(repo)).sort(), ["acme/web", "fork/web"]);
    await git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial"]);
    await git(["worktree", "add", "--detach", worktree]);
    assert.deepEqual((await readGitRepositories(worktree)).sort(), ["acme/web", "fork/web"]);
    await assert.rejects(readGitRepositories(join(root, "missing")), /Could not inspect/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("joins repository identity to custom project names and reports multiple local projects", async () => {
  const projects = [
    project("first", "/renamed", { projectCustomName: "My web project" }),
    project("second", "/another", { projectDisplayName: "Another checkout" }),
    project("unrelated", "/different-owner", { projectDisplayName: "web" }),
    project("directory", "/folder", { projectKind: "non_git", projectDisplayName: "web" }),
  ];
  const inspected: string[] = [];
  const result = await matchRepositoryProjects(source(projects), ["Acme/Web", "acme/web", "acme/missing"], async (path) => {
    inspected.push(path);
    return path === "/different-owner" ? ["other-owner/web"] : ["acme/web"];
  });
  assert.deepEqual(Object.keys(result.projectsByRepository).sort(), ["acme/missing", "acme/web"]);
  assert.equal(result.projectsByRepository["acme/web"].status, "available");
  assert.deepEqual(result.projectsByRepository["acme/web"].projects.map((item) => item.name), ["Another checkout", "My web project"]);
  assert.deepEqual(result.projectsByRepository["acme/missing"], { status: "missing", projects: [] });
  assert.equal(result.projectWarning, null);
  assert.ok(!inspected.includes("/folder"));
});

test("remote-less, foreign-host and similarly named projects do not create false matches", async () => {
  const projects = [project("one", "/web", { projectCustomName: "acme/web", projectDisplayName: "web" })];
  const result = await matchRepositoryProjects(source(projects), ["acme/web"], async () => []);
  assert.equal(result.projectsByRepository["acme/web"].status, "missing");
});

test("failed project checks preserve confirmed matches and show unknown rather than falsely claiming absence", async () => {
  const result = await matchRepositoryProjects(source([project("good", "/good"), project("missing", "/missing")]), ["acme/web", "acme/other"], async (path) => {
    if (path === "/missing") throw new Error("Directory no longer exists");
    return ["acme/web"];
  });
  assert.equal(result.projectsByRepository["acme/web"].status, "available");
  assert.equal(result.projectsByRepository["acme/other"].status, "unknown");
  assert.match(result.projectWarning!, /could not be checked/);
  const offline = { projects: { list: async () => { throw new Error("Host offline"); } } } as unknown as Source;
  assert.equal((await matchRepositoryProjects(offline, ["acme/web"])).projectsByRepository["acme/web"].status, "unknown");
  assert.deepEqual(await matchRepositoryProjects(offline, []), { projectsByRepository: {}, projectWarning: null });
});

test("project scans bound parallel reads and recheck changes on each refresh", async () => {
  const projects = Array.from({ length: 12 }, (_, i) => project(`project-${i}`, `/project-${i}`));
  let active = 0, maximum = 0, changed = false;
  const read = async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return changed ? [] : ["acme/web"];
  };
  const result = await matchRepositoryProjects(source(projects), ["acme/web"], read);
  assert.equal(result.projectsByRepository["acme/web"].projects.length, 12);
  assert.ok(maximum <= 4);
  changed = true;
  assert.equal((await matchRepositoryProjects(source(projects), ["acme/web"], read)).projectsByRepository["acme/web"].status, "missing");
});
