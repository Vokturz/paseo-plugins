import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { issueCountsSchema, issueSchema, type Issue } from "../shared/contracts";

export type IssueCounts = {
  total: number;
  byName: Record<string, number>;
  byType: Record<string, number>;
  complete: boolean;
};

type CacheEntry = {
  scope: string;
  showClosed: boolean;
  issues: Issue[];
  nextCursor: string | null;
  updatedAt: string;
  counts?: IssueCounts;
};

export type CachedOverview = Omit<CacheEntry, "scope" | "showClosed">;

// Keeps the API key out of the cache while still preventing a snapshot from one
// Linear account from being shown after the host switches credentials.
export function cacheScope(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export class TicketCache {
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly path = join(process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo"), "linear-tickets", "cache.json"),
  ) {}

  async read(scope: string, showClosed: boolean): Promise<CachedOverview | null> {
    await this.writes;
    const value = await this.readFile();
    if (!value || value.scope !== scope || value.showClosed !== showClosed) return null;
    return { issues: value.issues, nextCursor: value.nextCursor, updatedAt: value.updatedAt, ...(value.counts ? { counts: value.counts } : {}) };
  }

  saveIssues(scope: string, showClosed: boolean, page: { issues: Issue[]; nextCursor: string | null }): Promise<void> {
    return this.mutate(() => ({ scope, showClosed, issues: page.issues, nextCursor: page.nextCursor, updatedAt: new Date().toISOString() }));
  }

  saveCounts(scope: string, showClosed: boolean, counts: IssueCounts): Promise<void> {
    return this.mutate((current) => current && current.scope === scope && current.showClosed === showClosed
      ? { ...current, counts }
      : current);
  }

  private mutate(change: (current: CacheEntry | null) => CacheEntry | null): Promise<void> {
    const next = this.writes.then(async () => {
      const value = change(await this.readFile());
      if (value) await this.write(value);
    });
    this.writes = next.catch(() => {});
    return next;
  }

  private async readFile(): Promise<CacheEntry | null> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as Partial<CacheEntry>;
      if (!value || typeof value !== "object" || typeof value.scope !== "string" || typeof value.showClosed !== "boolean"
        || !Array.isArray(value.issues) || (typeof value.nextCursor !== "string" && value.nextCursor !== null)
        || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
        || !value.issues.every((issue) => issueSchema.safeParse(issue).success)) return null;
      if (value.counts && !issueCountsSchema.safeParse(value.counts).success) delete value.counts;
      return value as CacheEntry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
      throw new Error("Could not read the saved ticket cache.");
    }
  }

  private async write(value: CacheEntry): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }
}
