import type { PluginServerContext } from "@getpaseo/plugin/server";
import { GitHubReviews } from "./server/github";
import { listOwnersRpc, listReviewsRpc } from "./shared/contracts";
import { filterSettings } from "./shared/filters";
import { reviewerSettings } from "./shared/reviewer";

export default function contribute(server: PluginServerContext) {
  const github = new GitHubReviews();
  const settings = server.registerSettings(filterSettings);
  server.registerSettings(reviewerSettings);
  server.handle(listReviewsRpc, async (input) => {
    const saved = await settings.read();
    if (saved.status !== "ready") throw new Error("The saved PR filters are invalid. Open Filters and reset them to continue.");
    return github.list(input, saved.values);
  });
  server.handle(listOwnersRpc, (input) => github.owners(input));
  return () => {};
}
