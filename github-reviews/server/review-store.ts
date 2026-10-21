import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { prKey, reviewOutcomeSchema, reviewerIdentitySchema, reviewSubmissionSchema, type ReviewOutcome } from "../shared/publication";

export const runSchema = reviewOutcomeSchema.extend({
  version: z.literal(1), reviewer: reviewerIdentitySchema, workspaceId: z.string().nullable().default(null),
  submission: reviewSubmissionSchema.nullable().default(null), digest: z.string().nullable().default(null),
  uncertain: z.boolean().default(false), requestBody: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type ReviewRun = z.infer<typeof runSchema>;
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function reviewHome() { return process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo"); }

export class ReviewStore {
  readonly directory: string;
  constructor(home = reviewHome()) { this.directory = join(home, "github-reviews"); }
  private runPath(id: string) { return join(this.directory, "runs", `${z.uuid().parse(id)}.json`); }
  private targetPath(repository: string, number: number) { return join(this.directory, "targets", digest(prKey(repository, number))); }
  private async write(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  async read(id: string): Promise<ReviewRun | null> {
    let text: string;
    try { text = await readFile(this.runPath(id), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    return runSchema.parse(JSON.parse(text));
  }
  async create(run: ReviewRun) {
    await mkdir(join(this.directory, "runs"), { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    return this.lock(`run:${run.id}`, async () => {
      const prior = await this.read(run.id);
      if (prior) {
        if (prior.repository !== run.repository || prior.number !== run.number || prior.headSha !== run.headSha || prior.baseSha !== run.baseSha || prior.reviewer.id !== run.reviewer.id) throw new Error("This review run already belongs to another snapshot.");
      } else {
        await this.write(this.runPath(run.id), runSchema.parse(run));
      }
      const target = this.targetPath(run.repository, run.number);
      await mkdir(target, { recursive: true, mode: 0o700 });
      await this.write(join(target, `${run.id}.json`), { id: run.id });
      return prior ?? run;
    });
  }
  async update(id: string, change: (run: ReviewRun) => ReviewRun): Promise<ReviewRun> {
    return this.lock(`run:${id}`, async () => {
      const current = await this.read(id);
      if (!current) throw new Error("The review run is unavailable. Start a new review.");
      const next = runSchema.parse({ ...change(current), updatedAt: new Date().toISOString() });
      await this.write(this.runPath(id), next); return next;
    });
  }
  async runs(repository: string, number: number): Promise<ReviewRun[]> {
    let names: string[];
    try { names = await readdir(this.targetPath(repository, number)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const runs = await Promise.all(names.filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name)).map((name) => this.read(name.slice(0, -5))));
    return runs.filter((run): run is ReviewRun => Boolean(run && prKey(run.repository, run.number) === prKey(repository, number)));
  }
  async outcomes(repository: string, number: number): Promise<ReviewOutcome[]> {
    return (await this.runs(repository, number)).map((run) => reviewOutcomeSchema.parse(run));
  }
  async lock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const locks = join(this.directory, "locks");
    await mkdir(locks, { recursive: true, mode: 0o700 });
    const path = join(locks, digest(key));
    const nonce = randomUUID();
    const deadline = Date.now() + 30_000;
    while (true) {
      try { await mkdir(path, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = await stat(path).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 120_000) {
          const owner = await readFile(join(path, "owner.json"), "utf8").then((text) => JSON.parse(text) as { pid: number }, () => null);
          let alive = true;
          if (owner?.pid) { try { process.kill(owner.pid, 0); } catch (failure) { alive = (failure as NodeJS.ErrnoException).code !== "ESRCH"; } }
          if (!owner || !alive) { await rm(path, { recursive: true, force: true }); continue; }
        }
        if (Date.now() >= deadline) throw new Error("Another operation is publishing this PR. Retry when it finishes.");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try { await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, nonce }), { flag: "wx", mode: 0o600 }); }
    catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
    const heartbeat = setInterval(() => { const now = new Date(); void utimes(path, now, now).catch(() => {}); }, 5_000);
    try { return await action(); }
    finally {
      clearInterval(heartbeat);
      const owner = await readFile(join(path, "owner.json"), "utf8").then((text) => JSON.parse(text) as { nonce: string }, () => null);
      if (owner?.nonce === nonce) await rm(path, { recursive: true, force: true });
    }
  }
}
