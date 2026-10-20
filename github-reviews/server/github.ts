import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { listInputSchema, listOwnersInputSchema, MAX_PAGE, ownerPageSchema, PAGE_SIZE, reviewPageSchema, reviewTargetSchema, type PullRequestScope, type ReviewPage } from "../shared/contracts";
import { filtersSchema, ownerSchema, type Filters, type OwnerOption } from "../shared/filters";

const execute = promisify(execFile);
export type RunGh = (args: string[]) => Promise<string>;

export function searchQuery(login: string, scope: PullRequestScope, filters: Filters, now = new Date()): string {
  const normalized = filtersSchema.parse(filters);
  // Use an explicit union: review-involves can omit PRs returned by reviewed-by.
  const terms = ["is:pr", "is:open", scope === "created" ? `author:${login}` : `(review-requested:${login} OR reviewed-by:${login})`];
  // Advanced search intersects repeated user qualifiers; group an explicit union
  // so the saved owners continue to match any account in both search modes.
  const owners = normalized.owners.map((owner) => `user:${owner}`);
  if (scope === "review-requested" && owners.length > 1) terms.push(`(${owners.join(" OR ")})`);
  else terms.push(...owners);
  if (normalized.days !== null) {
    const since = new Date(now.getTime() - normalized.days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    terms.push(`${normalized.dateField}:>=${since}`);
  }
  return terms.join(" ");
}

// Never expose subprocess stderr: it can contain credentials or private API data.
export function commandError(error: unknown): Error {
  const failure = error as { code?: string; killed?: boolean; stderr?: string } | null;
  const stderr = failure?.stderr ?? "";
  if (failure?.code === "ENOENT") return new Error("Install GitHub CLI (gh) on the Paseo daemon host, then run gh auth login --hostname github.com.");
  if (failure?.killed || failure?.code === "ETIMEDOUT") return new Error("GitHub took too long to respond. Try refreshing again.");
  if (/rate limit|HTTP 429/i.test(stderr)) return new Error("GitHub is rate-limiting requests. Wait a few minutes before refreshing.");
  if (/HTTP 401|auth login|not logged|authentication|bad credentials/i.test(stderr)) return new Error("Sign in on the Paseo daemon host with gh auth login --hostname github.com, then refresh. If GH_TOKEN or GITHUB_TOKEN is set, check that token instead.");
  if (/HTTP 403/i.test(stderr)) return new Error("GitHub denied access. Check the host's GitHub account, token permissions and organization SSO authorization.");
  if (/HTTP 422/i.test(stderr)) return new Error("GitHub could not search pull requests for this account. Check its repository access and try again.");
  return new Error("Could not reach GitHub. Check the Paseo host's connection and GitHub CLI login, then refresh.");
}

export const runGh: RunGh = async (args) => {
  try {
    const { stdout } = await execute("gh", args, {
      timeout: 20_000,
      killSignal: "SIGKILL",
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GH_DEBUG: "" },
    });
    return stdout;
  } catch (error) { throw commandError(error); }
};

const viewerSchema = z.object({ login: z.string().regex(/^[A-Za-z0-9_-]+$/) });
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/i);
const prDetailSchema = z.object({
  number: z.number().int().positive(), title: z.string(), state: z.enum(["open", "closed"]),
  html_url: z.string(),
  base: z.object({ sha: commitSchema, ref: z.string(), repo: z.object({ full_name: z.string() }) }),
  head: z.object({ sha: commitSchema, ref: z.string() }),
});
export type ReviewDetail = { repository: string; number: number; title: string; url: string; baseSha: string; headSha: string; baseRef: string; headRef: string };
const searchSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(z.object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    title: z.string(),
    html_url: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/),
    state: z.literal("open"),
    user: z.object({ login: z.string() }).nullable(),
    updated_at: z.string(),
    labels: z.array(z.union([z.string(), z.object({ name: z.string() })])),
    draft: z.boolean().optional(),
    pull_request: z.object({ url: z.string() }),
  })),
});

export class GitHubReviews {
  constructor(private readonly run: RunGh = runGh) {}

  async detail(repository: string, number: number): Promise<ReviewDetail> {
    const target = reviewTargetSchema.parse({ repository, number });
    const parsed = prDetailSchema.safeParse(await this.api(`repos/${target.repository}/pulls/${target.number}`));
    if (!parsed.success) throw new Error("GitHub returned an unexpected pull request response. Refresh and try again.");
    const pr = parsed.data;
    const url = `https://github.com/${target.repository}/pull/${target.number}`;
    if (pr.number !== target.number || pr.base.repo.full_name.toLowerCase() !== target.repository || pr.html_url.toLowerCase() !== url) {
      throw new Error("The repository or pull request identity changed. Refresh the list before starting a review.");
    }
    if (pr.state !== "open") throw new Error("This pull request is no longer open. Refresh the list.");
    return { ...target, title: pr.title, url, baseSha: pr.base.sha, headSha: pr.head.sha, baseRef: pr.base.ref, headRef: pr.head.ref };
  }

  private async api(endpoint: string, fields: string[] = []): Promise<unknown> {
    const response = await this.run([
      "api", "--hostname", "github.com", "--method", "GET", endpoint,
      "-H", "Accept: application/vnd.github+json",
      ...fields.flatMap((field) => ["-f", field]),
    ]);
    try { return JSON.parse(response); }
    catch { throw new Error("GitHub CLI returned an invalid response. Try refreshing again."); }
  }

  async owners(input: { page?: number } = {}) {
    const { page } = listOwnersInputSchema.parse(input);
    const viewer = viewerSchema.safeParse(await this.api("user"));
    if (!viewer.success) throw new Error("GitHub did not return a valid signed-in account.");
    const repositories = z.array(z.object({ owner: z.object({ login: ownerSchema, type: z.enum(["User", "Organization", "Bot"]) }) }))
      .safeParse(await this.api("user/repos", ["per_page=100", `page=${page}`, "sort=full_name", "direction=asc"]));
    if (!repositories.success) throw new Error("GitHub returned an unexpected repository owner response. Try loading owners again.");
    const owners = new Map<string, OwnerOption>();
    const login = viewer.data.login.toLowerCase();
    owners.set(login, { login, kind: "user" });
    for (const { owner } of repositories.data) owners.set(owner.login, { login: owner.login, kind: owner.type === "Organization" ? "organization" : "user" });
    return ownerPageSchema.parse({ login, owners: [...owners.values()].sort((a, b) => a.login.localeCompare(b.login)), nextPage: repositories.data.length === 100 ? page + 1 : null });
  }

  async list(input: { page?: number; scope?: PullRequestScope } = {}, savedFilters: Filters = filtersSchema.parse({})): Promise<ReviewPage> {
    const { page, scope } = listInputSchema.parse(input);
    const filters = filtersSchema.parse(savedFilters);
    // Resolve the account on every request so gh auth switch never mixes accounts.
    const viewer = viewerSchema.safeParse(await this.api("user"));
    if (!viewer.success) throw new Error("GitHub did not return a valid signed-in account.");
    const login = viewer.data.login;
    const parsed = searchSchema.safeParse(await this.api("search/issues", [
      `q=${searchQuery(login, scope, filters)}`,
      ...(scope === "review-requested" ? ["advanced_search=true"] : []),
      "sort=updated", "order=desc", `per_page=${PAGE_SIZE}`, `page=${page}`,
    ]));
    if (!parsed.success) throw new Error("GitHub returned an unexpected pull request response. Try refreshing again.");
    const result = parsed.data;
    return reviewPageSchema.parse({
      login,
      scope,
      filters,
      pullRequests: result.items.map((pr) => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        repository: new URL(pr.html_url).pathname.split("/").slice(1, 3).join("/"),
        url: pr.html_url,
        author: pr.user?.login ?? null,
        updatedAt: pr.updated_at,
        labels: pr.labels.map((label) => typeof label === "string" ? label : label.name),
        draft: pr.draft ?? false,
      })),
      totalCount: result.total_count,
      page,
      nextPage: result.items.length === PAGE_SIZE && page < MAX_PAGE && page * PAGE_SIZE < result.total_count ? page + 1 : null,
      incomplete: result.incomplete_results,
      capped: result.total_count > PAGE_SIZE * MAX_PAGE,
      fetchedAt: new Date().toISOString(),
    });
  }
}
