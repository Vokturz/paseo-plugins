import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export class Credentials {
  constructor(
    private readonly path = join(process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo"), "linear-tickets", "credentials.json"),
    private readonly environmentKey = process.env.LINEAR_API_KEY?.trim(),
  ) {}

  async read() {
    if (this.environmentKey) return { key: this.environmentKey, source: "environment" as const };
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      if (typeof value.apiKey !== "string" || !value.apiKey.trim()) throw new Error("Invalid credentials");
      return { key: value.apiKey as string, source: "saved" as const };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { key: null, source: "none" as const };
      throw new Error("Could not read the saved Linear connection. Reconnect with your API key.");
    }
  }

  async save(apiKey: string) {
    if (this.environmentKey) throw new Error("This host uses LINEAR_API_KEY. Update that environment variable to change accounts.");
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ apiKey }), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }

  async remove() {
    if (this.environmentKey) throw new Error("Remove LINEAR_API_KEY from the Paseo host environment and restart to disconnect.");
    await rm(this.path, { force: true });
  }
}
