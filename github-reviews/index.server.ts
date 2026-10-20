import type { PluginServerContext } from "@getpaseo/plugin/server";
import { GitHubReviews } from "./server/github";
import { launchReviewRpc, listOwnersRpc, listReviewsRpc } from "./shared/contracts";
import { filterSettings } from "./shared/filters";
import { reviewerSettings } from "./shared/reviewer";
import { matchRepositoryProjects } from "./server/projects";
import { ReviewLauncher } from "./server/launch";

export default function contribute(server: PluginServerContext) {
  const github = new GitHubReviews();
  const settings = server.registerSettings(filterSettings);
  const reviewer = server.registerSettings(reviewerSettings);
  const launcher = new ReviewLauncher(github);
  server.handle(launchReviewRpc, async (input, { paseo }) => {
    const saved = await reviewer.read();
    if (saved.status !== "ready") throw new Error("The saved reviewer setup is invalid. Open Reviewer setup and reset it to continue.");
    return launcher.start(input, paseo, saved.values);
  });
  server.handle(listReviewsRpc, async (input, { paseo }) => {
    const saved = await settings.read();
    if (saved.status !== "ready") throw new Error("The saved PR filters are invalid. Open Filters and reset them to continue.");
    const page = await github.list(input, saved.values);
    const projects = await matchRepositoryProjects(paseo, page.pullRequests.map((pr) => pr.repository));
    return { ...page, ...projects };
  });
  server.handle(listOwnersRpc, (input) => github.owners(input));
  return () => {};
}
