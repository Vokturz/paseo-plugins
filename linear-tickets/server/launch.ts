import type { PaseoApi } from "@getpaseo/client";
import type { RpcInput } from "@getpaseo/plugin";
import { launchAgentRpc } from "../shared/contracts";
import { buildPrompt } from "./context";
import type { LinearService } from "./linear";
import { findProject, readBranches } from "./projects";

type Start = RpcInput<typeof launchAgentRpc>;
type Result = { agentId: string; warnings: string[] };

export class Launcher {
  private readonly requests = new Map<string, { fingerprint: string; result: Promise<Result> }>();
  private readonly active = new Map<string, Promise<Result>>();

  constructor(private readonly linear: Pick<LinearService, "detail">, private readonly branches = readBranches) {}

  start(input: Start, paseo: PaseoApi): Promise<Result> {
    const fingerprint = JSON.stringify([input.id, input.projectId, input.baseBranch, input.provider, input.modeId, input.thinkingOptionId, input.instructions]);
    const prior = this.requests.get(input.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return Promise.reject(new Error("This launch request has already been used. Reopen the ticket to start another agent."));
      return prior.result;
    }
    const active = this.active.get(fingerprint);
    if (active) {
      this.requests.set(input.requestId, { fingerprint, result: active });
      return active;
    }
    let creationStarted = false;
    const result = this.launch(input, paseo, () => { creationStarted = true; });
    this.requests.set(input.requestId, { fingerprint, result });
    this.active.set(fingerprint, result);
    void result.then(() => this.active.delete(fingerprint), () => {
      this.active.delete(fingerprint);
      // A creation request may have succeeded before its response was lost.
      // Keep that result so retrying this request cannot create a second agent.
      if (!creationStarted) {
        for (const [id, entry] of this.requests) {
          if (entry.result === result) this.requests.delete(id);
        }
      }
    });
    return result;
  }

  private async launch(input: Start, paseo: PaseoApi, onCreate: () => void): Promise<Result> {
    const project = await findProject(paseo, input.projectId);
    if (project.projectKind === "git") {
      const available = await this.branches(project.projectRootPath);
      if (!input.baseBranch || !available.branches.some((branch) => branch.id === input.baseBranch)) {
        throw new Error("Select an available base branch for this project.");
      }
    } else if (input.baseBranch) {
      throw new Error("This project does not support Git branches.");
    }
    const detail = await this.linear.detail(input.id);
    onCreate();
    const title = `${detail.issue.identifier}: ${detail.issue.title}`.slice(0, 60);
    const slug = detail.issue.identifier.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "ticket";
    const workspace = await paseo.workspaces.create({
      title,
      requestId: `${input.requestId}-workspace`,
      source: project.projectKind === "git"
        ? { kind: "worktree", projectId: project.projectId, cwd: project.projectRootPath, action: "branch-off", baseBranch: input.baseBranch, branchName: `${slug}-${input.requestId.slice(0, 8)}` }
        : { kind: "directory", projectId: project.projectId, path: project.projectRootPath },
    }).catch(() => {
      throw new Error("Workspace creation could not be confirmed. Check this project's workspaces before reopening the ticket to try again.");
    });
    const agent = await workspace.agents.create({
      config: { provider: input.provider, modeId: input.modeId, thinkingOptionId: input.thinkingOptionId },
      title,
      prompt: buildPrompt(detail, input.instructions),
      requestId: input.requestId,
      clientMessageId: input.requestId,
      labels: { "linear.issueId": detail.issue.id, "linear.identifier": detail.issue.identifier, "linear.url": detail.issue.url },
    }).catch(() => {
      throw new Error("Agent creation could not be confirmed. Check the workspace's agents before reopening this ticket to try again.");
    });
    return { agentId: agent.id, warnings: detail.warnings };
  }
}
