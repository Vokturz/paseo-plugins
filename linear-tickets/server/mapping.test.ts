import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mappingKey, mappingLabel, resolveMapping, MAX_PROJECT_MAPPINGS } from "../shared/mapping";
import { Settings } from "./settings";

const projects = [
  { projectId: "p-ops", projectDisplayName: "paseo-ops" },
  { projectId: "p-atlas", projectDisplayName: "Nexus Atlas", projectCustomName: null },
  { projectId: "p-dup-1", projectDisplayName: "claude" },
  { projectId: "p-dup-2", projectDisplayName: "Claude" },
];
const source = (projectId: string | null, projectName: string, teamId: string | null = "team-1") => ({ projectId, projectName, teamId, teamName: "TH1337" });

test("mapping keys prefer the Linear project and fall back to its team", () => {
  assert.equal(mappingKey(source("lp-1", "Ops")), "project:lp-1");
  assert.equal(mappingKey(source(null, "")), "team:team-1");
  assert.equal(mappingKey(source(null, "", null)), null);
  assert.equal(mappingLabel(source(null, "")), "TH1337 (no project)");
});

test("a saved mapping wins over a name match while its Paseo project exists", () => {
  const mappings = { "project:lp-1": { projectId: "p-atlas", baseBranch: "refs/heads/dev", label: "paseo-ops" } };
  assert.deepEqual(resolveMapping(source("lp-1", "paseo-ops"), mappings, projects), { projectId: "p-atlas", baseBranch: "refs/heads/dev", reason: "saved" });
  const stale = { "project:lp-1": { projectId: "gone", label: "paseo-ops" } };
  assert.deepEqual(resolveMapping(source("lp-1", "paseo-ops"), stale, projects), { projectId: "p-ops", reason: "name" });
});

test("name matching is case-insensitive, unique-only, and never applies to team fallbacks", () => {
  assert.deepEqual(resolveMapping(source("lp-2", "NEXUS atlas "), {}, projects), { projectId: "p-atlas", reason: "name" });
  assert.equal(resolveMapping(source("lp-3", "claude"), {}, projects), null);
  assert.equal(resolveMapping(source("lp-4", "Unknown"), {}, projects), null);
  assert.equal(resolveMapping(source(null, "paseo-ops"), {}, projects), null);
});

test("settings save, replace, forget and validate project mappings and the access toggle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-linear-mapping-"));
  const path = join(directory, "settings.json");
  try {
    const settings = new Settings(path);
    assert.equal((await settings.read()).agentLinearAccess, true);
    await settings.patch({ projectMapping: { key: "project:lp-1", projectId: "p-ops", baseBranch: "refs/heads/main", label: "paseo-ops" } });
    await settings.patch({ projectMapping: { key: "team:t-1", projectId: "p-atlas", label: "TH1337 (no project)" } });
    assert.deepEqual((await settings.read()).projectMappings, {
      "project:lp-1": { projectId: "p-ops", baseBranch: "refs/heads/main", label: "paseo-ops" },
      "team:t-1": { projectId: "p-atlas", label: "TH1337 (no project)" },
    });
    await settings.patch({ projectMapping: { key: "project:lp-1", projectId: "p-atlas", label: "paseo-ops" } });
    assert.deepEqual((await settings.read()).projectMappings["project:lp-1"], { projectId: "p-atlas", label: "paseo-ops" });
    await assert.rejects(settings.patch({ projectMapping: { key: "bogus", projectId: "p-ops", label: "x" } }), /not valid/);
    await settings.patch({ forgetProjectMapping: "project:lp-1" });
    await settings.patch({ forgetProjectMapping: "team:t-1" });
    await settings.patch({ agentLinearAccess: false });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { agentLinearAccess: false });
    await settings.patch({ agentLinearAccess: true });
    await assert.rejects(readFile(path), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("settings cap the number of project mappings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-linear-mapping-cap-"));
  try {
    const settings = new Settings(join(directory, "settings.json"));
    const full = Object.fromEntries(Array.from({ length: MAX_PROJECT_MAPPINGS }, (_, index) => [`project:p${index}`, { projectId: "x", label: "x" }]));
    await (settings as unknown as { write(value: unknown): Promise<unknown> }).write({ ...(await settings.read()), projectMappings: full });
    await assert.rejects(settings.patch({ projectMapping: { key: "project:new", projectId: "x", label: "x" } }), /At most/);
    await settings.patch({ projectMapping: { key: "project:p0", projectId: "y", label: "x" } });
    assert.equal((await settings.read()).projectMappings["project:p0"].projectId, "y");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
