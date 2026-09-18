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

  async read(): Promise<{ template: string | null }> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      if (typeof value.template === "string" && value.template.trim()) return { template: value.template };
      return { template: null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { template: null };
      throw new Error("Could not read the saved plugin settings.");
    }
  }

  async save(raw: string): Promise<{ template: string | null }> {
    const template = normalizeTemplate(raw);
    if (!template) {
      await rm(this.path, { force: true });
      return { template: null };
    }
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ template }), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
    return { template };
  }
}
