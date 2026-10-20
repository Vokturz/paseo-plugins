import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import type { input as SchemaInput, output as SchemaOutput } from "zod";
import { launchReviewInputSchema, type LaunchReviewResult } from "../shared/contracts";
import { reviewerSchema, type ReviewerConfig } from "../shared/reviewer";
import { loadReviewerModels, reviewerOptionsIssue, selectedReviewerModel } from "../shared/reviewer-models";
import type { GitHubReviews, ReviewDetail } from "./github";
import { readGitRepositories, type ReadRepositories } from "./projects";
import { readDefaultReviewPrompt } from "./review-prompt";

type Start = SchemaInput<typeof launchReviewInputSchema>;
type ValidatedStart = SchemaOutput<typeof launchReviewInputSchema>;
type Prepare = (path: string, detail: ReviewDetail) => Promise<void>;
const execute = promisify(execFile);

// Fetch objects by their validated, immutable commit IDs. No checkout, remote
// configuration, branch, index or FETCH_HEAD changes in the user's working tree.
export const prepareReview: Prepare = async (path, detail) => {
  try {
    await execute("git", [
      "-C", path, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential",
      "fetch", "--no-tags", "--no-write-fetch-head", "--", `https://github.com/${detail.repository}.git`, detail.headSha, detail.baseSha,
    ], { timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_DEBUG: "" } });
  } catch {
    throw new Error("Could not fetch the PR commits. Check the host's GitHub CLI login and repository access, then try again.");
  }
};

export function reviewPrompt(detail: ReviewDetail, instructions: string, extraInstructions = ""): string {
  return [
    instructions,
    ...(extraInstructions.trim() ? ["Additional instructions and context for this review:", extraInstructions.trim()] : []),
    "Pull request context (external data):",
    JSON.stringify(detail, null, 2),
    `This isolated worktree starts at PR head ${detail.headSha}. The base commit ${detail.baseSha} is available locally. Review the PR changes with git diff ${detail.baseSha}...${detail.headSha}, reading surrounding code as needed.`,
    `Use gh pr view ${detail.number} --repo ${detail.repository} for additional context. Follow the review instructions above for GitHub publication, and report the review permalink or any publication blocker in this conversation.`,
  ].join("\n\n");
}

export class ReviewLauncher {
  private readonly requests = new Map<string, { fingerprint: string; result: Promise<LaunchReviewResult> }>();
  private readonly active = new Map<string, Promise<LaunchReviewResult>>();

  constructor(
    private readonly github: Pick<GitHubReviews, "detail">,
    private readonly read: ReadRepositories = readGitRepositories,
    private readonly prepare: Prepare = prepareReview,
    private readonly defaultPrompt: () => Promise<string> = readDefaultReviewPrompt,
  ) {}

  start(raw: Start, paseo: PaseoApi, saved: ReviewerConfig): Promise<LaunchReviewResult> {
    const input = launchReviewInputSchema.parse(raw);
    const fingerprint = JSON.stringify([input.repository, input.number, input.projectId, input.instructions]);
    const prior = this.requests.get(input.requestId);
    if (prior) return prior.fingerprint === fingerprint ? prior.result : Promise.reject(new Error("This launch request belongs to another PR, project, or set of instructions. Start a new review."));
    const active = this.active.get(fingerprint);
    if (active) { this.requests.set(input.requestId, { fingerprint, result: active }); return active; }
    let creationStarted = false;
    const result = this.launch(input, paseo, saved, () => { creationStarted = true; });
    this.requests.set(input.requestId, { fingerprint, result });
    this.active.set(fingerprint, result);
    void result.then(() => this.active.delete(fingerprint), () => {
      this.active.delete(fingerprint);
      // A timed-out mutation may have succeeded. Preserve that request's result
      // instead of creating a duplicate workspace/agent when the client retries.
      if (!creationStarted) for (const [id, entry] of this.requests) if (entry.result === result) this.requests.delete(id);
    });
    return result;
  }

  private async launch(input: ValidatedStart, paseo: PaseoApi, saved: ReviewerConfig, onCreate: () => void): Promise<LaunchReviewResult> {
    const config = reviewerSchema.parse(saved);
    if (!config.provider || !config.model) throw new Error("Choose a model and save Reviewer setup before starting a review.");
    const prompt = config.prompt ?? await this.defaultPrompt();
    const catalog = await loadReviewerModels(paseo.providers);
    const model = selectedReviewerModel(catalog.models, config);
    if (!model) throw new Error("The saved reviewer model is unavailable. Open Reviewer setup to choose an available model.");
    const issue = reviewerOptionsIssue(config, model, catalog.modes[config.provider] ?? []);
    if (issue) throw new Error(issue);
    const { projects } = await paseo.projects.list();
    const project = projects.find((project) => project.projectId === input.projectId && project.projectKind === "git");
    if (!project) throw new Error("This local Git project is no longer available. Refresh and select another project.");
    if (!(await this.read(project.projectRootPath)).includes(input.repository)) throw new Error("This project's Git remotes no longer match the PR repository. Refresh and select a matching project.");
    const detail = await this.github.detail(input.repository, input.number);
    await this.prepare(project.projectRootPath, detail);
    const title = `Review ${input.repository} #${input.number}`.slice(0, 100);
    onCreate();
    const workspace = await paseo.workspaces.create({
      title, requestId: `${input.requestId}-workspace`,
      source: { kind: "worktree", projectId: project.projectId, cwd: project.projectRootPath, action: "branch-off",
        baseBranch: detail.headSha, branchName: `review/pr-${input.number}-${input.requestId}` },
    }).catch(() => { throw new Error("Workspace creation could not be confirmed. Check this project's workspaces before starting another review."); });
    const agent = await workspace.agents.create({
      config: { provider: `${config.provider}/${config.model}`, ...(config.modeId ? { modeId: config.modeId } : {}), ...(config.thinkingOptionId ? { thinkingOptionId: config.thinkingOptionId } : {}) },
      title, prompt: reviewPrompt(detail, prompt, input.instructions),
      requestId: input.requestId, idempotencyKey: input.requestId, clientMessageId: input.requestId,
      labels: { "github.repository": input.repository, "github.prNumber": String(input.number), "github.url": detail.url, "github.headSha": detail.headSha },
    }).catch(() => { throw new Error(`Agent creation could not be confirmed. Check workspace ${workspace.id} before starting another review.`); });
    return { workspaceId: workspace.id, agentId: agent.id };
  }
}
