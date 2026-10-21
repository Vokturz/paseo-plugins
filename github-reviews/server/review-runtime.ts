import type { PaseoAgentCreateOptions } from "@getpaseo/client";
import { z } from "zod";
import { reviewOutcomeSchema } from "../shared/publication";
import type { GitHubReviews, ReviewDetail } from "./github";
import { ReviewStore, reviewHome } from "./review-store";
import { REVIEW_MCP_PATH, REVIEW_TSX_LOADER } from "./review-prompt-path.generated";

export const REVIEW_MCP_NAME = "github_review";
export type ReviewSession = { instructions: string; reviewOnly?: boolean; config: Pick<PaseoAgentCreateOptions["config"], "mcpServers" | "toolPolicy"> };
export interface LaunchPublication {
  prepare(id: string, detail: ReviewDetail): Promise<ReviewSession>;
  created(id: string, agentId: string, workspaceId: string): Promise<void>;
  blocked(id: string, reason: string): Promise<void>;
}
function quote(value: string) { return `'${value.replace(/'/g, `'\\''`)}'`; }

export class ReviewRuntime implements LaunchPublication {
  constructor(private readonly github: Pick<GitHubReviews, "identity">, readonly store = new ReviewStore(), private readonly home = reviewHome()) {}
  async prepare(id: string, detail: ReviewDetail): Promise<ReviewSession> {
    const reviewer = await this.github.identity();
    const run = await this.store.create({ id, agentId: id, repository: detail.repository, number: detail.number, headSha: detail.headSha, baseSha: detail.baseSha,
      version: 1, reviewer, workspaceId: null, status: "reviewing", reviewOnly: detail.draft === true, reason: null, reviewUrl: null, updatedAt: new Date().toISOString(),
      submission: null, digest: null, uncertain: false, requestBody: null });
    const args = ["--import", REVIEW_TSX_LOADER, REVIEW_MCP_PATH, "--run", id, "--home", this.home];
    const fallback = [process.execPath, ...args, "--submit"].map(quote).join(" ");
    return {
      reviewOnly: run.reviewOnly,
      config: {
        mcpServers: { [REVIEW_MCP_NAME]: { type: "stdio", command: process.execPath, args, alwaysLoad: true,
          ...(process.versions.electron ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {}) } },
        toolPolicy: { preapproved: ["get_review_status", "submit_review", "report_review_blocker"].map((tool) => ({ kind: "mcp" as const, server: REVIEW_MCP_NAME, tool })) },
      },
      instructions: run.reviewOnly ? [
        "Mandatory review-only mode for this run:",
        "This PR was a draft when this run started. Review the code and present your findings in this conversation. Do not publish a GitHub review, comment, or any other GitHub write, even if the saved prompt authorizes publication or the PR becomes ready later.",
        "Use github_review submit_review after validation to save the completed result locally. It will not publish for this run. Use report_review_blocker if inspection cannot be completed.",
        "Submit {complete:true, conclusion:'clean'|'issues'|'follow-up', body?:string, findings:[{key,priority:'P1'|'P2',title,body,path,side:'RIGHT'|'LEFT',line,startLine?}]}. Use findings:[] for a clean review. Keep the full findings in this conversation as well.",
        `If MCP is unavailable, submit the same JSON on stdin to: ${process.versions.electron ? "ELECTRON_RUN_AS_NODE=1 " : ""}${fallback}`,
      ].join("\n\n") : [
        "Mandatory GitHub publication route for this run:",
        "Publish only through the github_review submit_review tool. It performs account/snapshot checks, diff-anchor validation, durable duplicate prevention, and serialized COMMENT submission. Do not bypass it with gh writes, HTTP requests, or another GitHub tool. gh remains available for read-only inspection.",
        "For publication authorized by the selected review prompt, after the complete review and independent validation submit {complete:true, conclusion:'clean'|'issues'|'follow-up', body?:string, findings:[{key,priority:'P1'|'P2',title,body,path,side:'RIGHT'|'LEFT',line,startLine?}], fixedCommentIds?:number[]}. Give each issue a stable lowercase key describing its path and failure (for example 'auth/session:refresh-after-logout'); preserve that key for the same defect in later reviews. Use findings:[] for a clean or existing-issue follow-up review. If no content is eligible for publication, submit a follow-up with empty body and no findings; it records a skipped result without posting. Provide fixedCommentIds only after independently verifying every outstanding prior finding is fixed.",
        "The handler supplies snapshot links, badges and hidden deduplication markers. Do not supply those markers yourself. It may return skipped when findings are already reported. If blocked, report the reason and use get_review_status to reconcile an uncertain submission; never retry with a different payload or publish directly. Use report_review_blocker if inspection cannot be completed.",
        `If MCP tools are unavailable, the same guarded handler is available via this command, with the submission JSON on stdin: ${process.versions.electron ? "ELECTRON_RUN_AS_NODE=1 " : ""}${fallback}`,
        "Return the handler's verified GitHub review link or publication outcome in this conversation. Thread resolution is outside this publication tool; do not perform GitHub writes outside this route.",
      ].join("\n\n"),
    };
  }
  async created(id: string, agentId: string, workspaceId: string) { await this.store.update(id, (run) => ({ ...run, agentId, workspaceId })); }
  async blocked(id: string, reason: string) { await this.store.update(id, (run) => ["published", "completed", "publishing"].includes(run.status) || run.uncertain ? run : { ...run, status: "blocked", reason }); }
  async turn(agentId: string, started: boolean) {
    if (!z.uuid().safeParse(agentId).success) return;
    if (!await this.store.read(agentId)) return;
    await this.store.update(agentId, (run) => {
      if (["published", "completed", "skipped", "publishing"].includes(run.status) || run.uncertain) return run;
      if (started) return { ...run, status: "reviewing", reason: null };
      if (run.status !== "reviewing") return run;
      return { ...run, status: "blocked", reason: "The agent finished without a verified publication. Open the agent for its findings or blocker." };
    });
  }
  async status(id: string) { const run = await this.store.read(id); return run ? reviewOutcomeSchema.parse(run) : null; }
}
