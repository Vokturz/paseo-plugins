import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GitHubReviewsSurface } from "./client/github-reviews";
import { ReviewerSetupSurface } from "./client/reviewer-setup";

export default function contribute(client: PluginClientContext) {
  const openReviewer = () => client.openScreen({ screenId: "github-reviewer-setup" });
  client.addSurface("github-reviews", (props) => <GitHubReviewsSurface {...props} onOpenReviewer={openReviewer} />);
  client.addScreen({ id: "github-reviewer-setup", title: "Reviewer setup", Component: (props) => <ReviewerSetupSurface {...props} onBack={() => client.openSurface("github-reviews")} /> });
  client.addSidebarItem({ id: "github-reviews", title: "GitHub reviews", icon: "GitPullRequest", surface: "github-reviews" });
  client.addCommandCenterItem({
    id: "open-github-reviews", title: "Open GitHub pull requests", icon: "GitPullRequest", context: "global",
    keywords: ["github", "pull request", "review", "PR", "created", "author"],
    onSelect({ openSurface }) { openSurface("github-reviews"); },
  });
  client.addCommandCenterItem({
    id: "open-github-reviewer-setup", title: "Configure GitHub reviewer", icon: "Bot", context: "global", keywords: ["github", "review", "model", "prompt"],
    onSelect({ openScreen }) { openScreen({ screenId: "github-reviewer-setup" }); },
  });
  return () => {};
}
