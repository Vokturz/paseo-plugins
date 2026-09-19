import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MAX_TEMPLATE_LENGTH = 8_000;

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
  constructor(
    private readonly path = join(process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo"), "linear-tickets", "settings.json"),
  ) {}

  private async readFile(): Promise<{ template?: string; markInProgress?: boolean; showClosed?: boolean }> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      return value && typeof value === "object" ? (value as { template?: string; markInProgress?: boolean; showClosed?: boolean }) : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Could not read the saved plugin settings.");
    }
  }

  async read(): Promise<{ template: string | null; markInProgress: boolean; showClosed: boolean }> {
    const value = await this.readFile();
    return {
      template: typeof value.template === "string" && value.template.trim() ? value.template : null,
      markInProgress: value.markInProgress === true,
      showClosed: value.showClosed === true,
    };
  }

  async save(raw: string): Promise<{ template: string | null; markInProgress: boolean; showClosed: boolean }> {
    const current = await this.read();
    return this.write({ template: normalizeTemplate(raw), markInProgress: current.markInProgress, showClosed: current.showClosed });
  }

  // Patches only the provided fields; `template: ""` clears the template (built-in default).
  async patch(patch: { template?: string; markInProgress?: boolean; showClosed?: boolean }): Promise<{ template: string | null; markInProgress: boolean; showClosed: boolean }> {
    const current = await this.read();
    const template = patch.template === undefined ? current.template : normalizeTemplate(patch.template);
    const markInProgress = patch.markInProgress === undefined ? current.markInProgress : patch.markInProgress;
    const showClosed = patch.showClosed === undefined ? current.showClosed : patch.showClosed;
    return this.write({ template, markInProgress, showClosed });
  }

  private async write(value: { template: string | null; markInProgress: boolean; showClosed: boolean }): Promise<{ template: string | null; markInProgress: boolean; showClosed: boolean }> {
    if (!value.template && !value.markInProgress && !value.showClosed) {
      await rm(this.path, { force: true });
      return value;
    }
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const fileValue: { template?: string; markInProgress?: boolean; showClosed?: boolean } = {};
    if (value.template) fileValue.template = value.template;
    if (value.markInProgress) fileValue.markInProgress = true;
    if (value.showClosed) fileValue.showClosed = true;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(fileValue), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
    return value;
  }
}
