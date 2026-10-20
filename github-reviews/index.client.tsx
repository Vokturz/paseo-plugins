import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GitHubReviewsSurface } from "./client/github-reviews";

export default function contribute(client: PluginClientContext) {
  client.addSurface("github-reviews", GitHubReviewsSurface);
  client.addSidebarItem({ id: "github-reviews", title: "GitHub reviews", icon: "GitPullRequest", surface: "github-reviews" });
  client.addCommandCenterItem({
    id: "open-github-reviews", title: "Open GitHub pull requests", icon: "GitPullRequest", context: "global",
    keywords: ["github", "pull request", "review", "PR", "created", "author"],
    onSelect({ openSurface }) { openSurface("github-reviews"); },
  });
  return () => {};
}
