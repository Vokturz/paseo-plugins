import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_PROJECT_MAPPINGS, type ProjectMapping } from "../shared/mapping";

export const MAX_TEMPLATE_LENGTH = 8_000;

export type LaunchPreference = { model: string; modeId?: string; thinkingOptionId?: string };
export type PluginSettings = {
  template: string | null;
  markInProgress: boolean;
  showClosed: boolean;
  lastProvider: string | null;
  launchPreferences: Record<string, LaunchPreference>;
  projectMappings: Record<string, ProjectMapping>;
  agentLinearAccess: boolean;
};

type SettingsFile = {
  template?: string;
  markInProgress?: boolean;
  showClosed?: boolean;
  lastProvider?: string;
  launchPreferences?: Record<string, LaunchPreference>;
  projectMappings?: Record<string, ProjectMapping>;
  agentLinearAccess?: boolean;
};

function savedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 500 ? value : undefined;
}

function normalizeLaunchPreferences(value: unknown): Record<string, LaunchPreference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 50).flatMap(([provider, raw]) => {
    if (!savedString(provider) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const candidate = raw as Record<string, unknown>;
    const model = savedString(candidate.model);
    if (!model) return [];
    const modeId = savedString(candidate.modeId);
    const thinkingOptionId = savedString(candidate.thinkingOptionId);
    return [[provider, { model, ...(modeId ? { modeId } : {}), ...(thinkingOptionId ? { thinkingOptionId } : {}) }]];
  }));
}

const MAPPING_KEY = /^(project|team):[A-Za-z0-9_-]{1,100}$/;
export function normalizeProjectMappings(value: unknown): Record<string, ProjectMapping> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, MAX_PROJECT_MAPPINGS).flatMap(([key, raw]) => {
    if (!MAPPING_KEY.test(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const candidate = raw as Record<string, unknown>;
    const projectId = savedString(candidate.projectId);
    if (!projectId) return [];
    const baseBranch = savedString(candidate.baseBranch);
    const label = savedString(candidate.label) ?? key;
    return [[key, { projectId, label, ...(baseBranch ? { baseBranch } : {}) }]];
  }));
}

export type SettingsPatch = {
  template?: string;
  markInProgress?: boolean;
  showClosed?: boolean;
  agentLinearAccess?: boolean;
  launchPreference?: { provider: string } & LaunchPreference;
  projectMapping?: { key: string } & ProjectMapping;
  forgetProjectMapping?: string;
};

// Returns null for an empty template (meaning: use the built-in default).
export function normalizeTemplate(raw: string): string | null {
  const template = raw.trim();
  if (!template) return null;
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new Error(`The default prompt template is limited to ${MAX_TEMPLATE_LENGTH.toLocaleString("en-US")} characters.`);
  }
  if (!template.includes("{{context}}")) {
    throw new Error("The default prompt template must include {{context}} — that is where the ticket snapshot goes.");
  }
  return template;
}

export class Settings {
  // Every read-modify-write runs in order, so concurrent patches cannot drop each other.
  private queue: Promise<unknown> = Promise.resolve();
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  constructor(
    private readonly path = join(process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo"), "linear-tickets", "settings.json"),
  ) {}

  private async readFile(): Promise<SettingsFile> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      return value && typeof value === "object" ? (value as SettingsFile) : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Could not read the saved plugin settings.");
    }
  }

  async read(): Promise<PluginSettings> {
    const value = await this.readFile();
    const launchPreferences = normalizeLaunchPreferences(value.launchPreferences);
    const lastProvider = savedString(value.lastProvider);
    return {
      template: typeof value.template === "string" && value.template.trim() ? value.template : null,
      markInProgress: value.markInProgress === true,
      showClosed: value.showClosed === true,
      lastProvider: lastProvider && launchPreferences[lastProvider] ? lastProvider : null,
      launchPreferences,
      projectMappings: normalizeProjectMappings(value.projectMappings),
      agentLinearAccess: value.agentLinearAccess !== false,
    };
  }

  save(raw: string): Promise<PluginSettings> {
    return this.serialize(() => this.saveNow(raw));
  }

  private async saveNow(raw: string): Promise<PluginSettings> {
    const current = await this.read();
    return this.write({ ...current, template: normalizeTemplate(raw) });
  }

  // Patches only the provided fields; `template: ""` clears the template (built-in default).
  patch(patch: SettingsPatch): Promise<PluginSettings> {
    return this.serialize(() => this.patchNow(patch));
  }

  private async patchNow(patch: SettingsPatch): Promise<PluginSettings> {
    const current = await this.read();
    const next: PluginSettings = {
      ...current,
      template: patch.template === undefined ? current.template : normalizeTemplate(patch.template),
      markInProgress: patch.markInProgress ?? current.markInProgress,
      showClosed: patch.showClosed ?? current.showClosed,
      agentLinearAccess: patch.agentLinearAccess ?? current.agentLinearAccess,
    };
    if (patch.launchPreference) {
      const { provider, model, modeId, thinkingOptionId } = patch.launchPreference;
      next.lastProvider = provider;
      next.launchPreferences = { ...current.launchPreferences, [provider]: { model, ...(modeId ? { modeId } : {}), ...(thinkingOptionId ? { thinkingOptionId } : {}) } };
    }
    if (patch.projectMapping || patch.forgetProjectMapping) {
      const mappings = { ...current.projectMappings };
      if (patch.forgetProjectMapping) delete mappings[patch.forgetProjectMapping];
      if (patch.projectMapping) {
        const { key, ...mapping } = patch.projectMapping;
        delete mappings[key];
        if (Object.keys(mappings).length >= MAX_PROJECT_MAPPINGS) throw new Error(`At most ${MAX_PROJECT_MAPPINGS} project mappings can be saved. Forget one in Settings first.`);
        mappings[key] = mapping;
      }
      next.projectMappings = normalizeProjectMappings(mappings);
      if (patch.projectMapping && !next.projectMappings[patch.projectMapping.key]) throw new Error("This project mapping is not valid.");
    }
    return this.write(next);
  }

  private async write(value: PluginSettings): Promise<PluginSettings> {
    const hasMappings = Object.keys(value.projectMappings).length > 0;
    if (!value.template && !value.markInProgress && !value.showClosed && !value.lastProvider && !Object.keys(value.launchPreferences).length && !hasMappings && value.agentLinearAccess) {
      await rm(this.path, { force: true });
      return value;
    }
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const fileValue: SettingsFile = {};
    if (value.template) fileValue.template = value.template;
    if (value.markInProgress) fileValue.markInProgress = true;
    if (value.showClosed) fileValue.showClosed = true;
    if (value.lastProvider) fileValue.lastProvider = value.lastProvider;
    if (Object.keys(value.launchPreferences).length) fileValue.launchPreferences = value.launchPreferences;
    if (hasMappings) fileValue.projectMappings = value.projectMappings;
    if (!value.agentLinearAccess) fileValue.agentLinearAccess = false;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(fileValue), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
    return value;
  }
}
