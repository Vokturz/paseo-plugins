import type { PluginServerContext } from "@getpaseo/plugin/server";
import { GitHubReviews } from "./server/github";
import { batchReviewOutcomesRpc, defaultReviewPromptRpc, launchReviewRpc, listOwnersRpc, listReviewsRpc, reviewOutcomesRpc } from "./shared/contracts";
import { prKey } from "./shared/publication";
import { filterSettings } from "./shared/filters";
import { reviewerSettings } from "./shared/reviewer";
import { matchRepositoryProjects } from "./server/projects";
import { ReviewLauncher } from "./server/launch";
import { readDefaultReviewPrompt } from "./server/review-prompt";
import { ReviewRuntime } from "./server/review-runtime";

export default function contribute(server: PluginServerContext) {
  const github = new GitHubReviews();
  const settings = server.registerSettings(filterSettings);
  const reviewer = server.registerSettings(reviewerSettings);
  const runtime = new ReviewRuntime(github);
  const launcher = new ReviewLauncher(github, undefined, undefined, undefined, runtime);
  server.handle(launchReviewRpc, async (input, { paseo }) => {
    const saved = await reviewer.read();
    if (saved.status !== "ready") throw new Error("The saved reviewer setup is invalid. Open Reviewer setup and reset it to continue.");
    return launcher.start(input, paseo, saved.values);
  });
  server.handle(listReviewsRpc, async (input, { paseo }) => {
    const saved = await settings.read();
    if (saved.status !== "ready") throw new Error("The saved PR filters are invalid. Open Filters and reset them to continue.");
    const page = await github.list(input, saved.values);
    const [projects, heads] = await Promise.all([matchRepositoryProjects(paseo, page.pullRequests.map((pr) => pr.repository)),
      page.reviewFilter === "outdated" ? { heads: page.headsByPr, warning: page.headWarning } : github.heads(page.pullRequests)]);
    return { ...page, ...projects, headsByPr: heads.heads, headWarning: heads.warning };
  });
  server.handle(listOwnersRpc, (input) => github.owners(input));
  server.handle(defaultReviewPromptRpc, async () => ({ prompt: await readDefaultReviewPrompt() }));
  server.handle(reviewOutcomesRpc, async ({ repository, number }) => ({ runs: await runtime.store.outcomes(repository, number) }));
  server.handle(batchReviewOutcomesRpc, async ({ targets }) => {
    const unique = [...new Map(targets.map((target) => [prKey(target.repository, target.number), target])).values()];
    const results = await Promise.allSettled(unique.map(async ({ repository, number }) => [prKey(repository, number), await runtime.store.outcomes(repository, number)] as const));
    return {
      runsByPr: Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])),
      failedTargets: results.flatMap((result, index) => result.status === "rejected" ? [prKey(unique[index].repository, unique[index].number)] : []),
    };
  });
  const started = server.on("agent.turn_started", async ({ agent }) => { await runtime.turn(agent.id, true); });
  const ended = server.on("agent.turn_ended", async ({ agent }) => { await runtime.turn(agent.id, false); });
  return () => { started(); ended(); };
}
