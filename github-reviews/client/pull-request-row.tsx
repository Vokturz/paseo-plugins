import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { MAX_REVIEW_INSTRUCTIONS_LENGTH, type PullRequest } from "../shared/contracts";
import type { RepositoryProjects } from "../shared/projects";
import { ChoicePicker } from "./choice-picker";
import { tokensFor } from "./design";
import { absoluteTime, relativeTime } from "./list-presentation";
import { ProjectAvailability } from "./project-availability";
import type { useReviewLaunch } from "./review-action";
import { reviewProgress } from "./review-outcomes";
import { reviewPrimaryAction } from "./review-primary-action";
import { ActionButton, Interactive } from "./ui";
import { useReviewAgents } from "./use-review-agents";
import { useReviewOutcomes } from "./use-review-outcomes";

export function PullRequestRow({ pr, match, theme, layout, navigation, configured, onOpenReviewer, launcher, currentHead, onOpenPR, visible, first, now }: {
  pr: PullRequest; match?: RepositoryProjects; configured: boolean; onOpenReviewer?: () => void;
  currentHead?: string | null; launcher: ReturnType<typeof useReviewLaunch>; onOpenPR: () => void;
  visible: boolean; first: boolean; now: number;
} & Pick<PluginSurfaceProps, "theme" | "layout" | "navigation">) {
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const instructions = launcher.instructions(pr);
  const projects = match?.projects ?? [];
  const projectId = projects.length === 1 ? projects[0].projectId : projects.some((project) => project.projectId === selection) ? selection : "";
  const state = launcher.state(pr, projectId);
  const linked = useReviewAgents(pr, state?.result?.agentId);
  const outcomes = useReviewOutcomes(pr, linked.agents);
  const hasReview = Boolean(linked.pendingCreatedAgentId || linked.agents.length);
  const activeAgent = linked.agents.find((agent) => ["running", "initializing"].includes(agent.status));
  const featured = activeAgent ?? linked.agents[0];
  const progress = featured ? reviewProgress(featured, outcomes.runs, currentHead) : null;
  const canLaunch = match?.status === "available" && projects.length > 0;
  const action = reviewPrimaryAction({ agents: linked.agents, runs: outcomes.runs, currentHead,
    busy: Boolean(state?.busy), loading: linked.loading, failed: Boolean(linked.error), createdAgentId: linked.pendingCreatedAgentId,
    configured, canLaunch, projectId, draft: pr.draft });
  const t = tokensFor(theme, layout), c = t.colors;
  const openReview = async (url: string) => {
    setLinkError(null);
    try { await openExternalUrl(url); } catch { setLinkError("Could not open the review in your browser. Try again."); }
  };
  const start = () => void launcher.start(pr, projectId);
  const primary = () => {
    switch (action.kind) {
      case "start": start(); break;
      case "choose-project": setExpanded(true); break;
      case "configure": onOpenReviewer?.(); break;
      case "open-pr": onOpenPR(); break;
      case "open-agent": if (navigation) navigation.openAgent({ agentId: action.agentId }); else setExpanded(true); break;
      case "view-review": void openReview(action.url); break;
      case "retry-status": void linked.refresh(); break;
    }
  };
  const statusColor = progress?.status === "published" || progress?.status === "completed" ? c.statusSuccess
    : progress?.status === "blocked" || progress?.outdated ? c.statusWarning : c.foregroundMuted;
  const label = action.kind === "start" && state?.error ? "Retry review"
    : action.kind === "open-agent" && !navigation ? "View agent details" : action.label;

  return <View accessibilityElementsHidden={!visible} importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    style={{ display: visible ? "flex" : "none", gap: 10, padding: layout.compact ? 14 : 16,
    borderTopWidth: first ? 0 : 1, borderTopColor: c.border }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View style={{ paddingTop: 3 }}><Icon name="GitPullRequest" size={17} color={pr.draft ? c.foregroundMuted : c.statusSuccess} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Interactive t={t} accessibilityRole="link" accessibilityLabel={`Open ${pr.repository} #${pr.number}: ${pr.title}`} onPress={onOpenPR}>
          <Text numberOfLines={expanded ? undefined : 2} style={{ color: c.foreground, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{pr.title}</Text>
        </Interactive>
        <Text style={t.muted}>{pr.repository} <Text style={{ fontWeight: "600" }}>#{pr.number}</Text> · {pr.author ? `@${pr.author}` : "Deleted account"}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Text accessibilityLabel={`Pull request updated ${absoluteTime(pr.updatedAt)}`} style={t.muted}>Updated {relativeTime(pr.updatedAt, now)}</Text>
          <Text style={{ color: statusColor, fontSize: 12, fontWeight: "600" }}>{state?.busy ? "Starting review…" : progress?.label ?? (linked.loading ? "Checking reviews…" : linked.error ? "Review status unavailable" : "No Paseo review")}</Text>
          {progress?.outdated && <Text style={{ ...t.muted, color: c.statusWarning }}>New commits</Text>}
          {pr.draft && <Text style={{ ...t.muted, color: c.statusWarning }}>Draft · local review only</Text>}
        </View>
      </View>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingLeft: 27 }}>
      <ActionButton title={label} size="sm" primary t={t}
        icon={action.kind === "view-review" || action.kind === "open-pr" ? "ExternalLink" : action.kind === "open-agent" ? "ArrowUpRight" : "Bot"}
        disabled={action.kind === "starting" || action.kind === "checking" || (action.kind === "configure" && !onOpenReviewer)} onPress={primary} />
      <Interactive t={t} accessibilityRole="button" accessibilityLabel={`${expanded ? "Hide" : "Show"} details for ${pr.repository} #${pr.number}`}
        accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => ({ minHeight: t.touchTarget, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, backgroundColor: pressed ? c.surface2 : "transparent" })}>
        <Text style={t.muted}>{expanded ? "Hide details" : "Details"}{linked.agents.length > 1 ? ` · ${linked.agents.length} runs` : ""}</Text>
        <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={13} color={c.foregroundMuted} />
      </Interactive>
    </View>
    {state?.error && <Text accessibilityRole="alert" style={{ ...t.muted, color: c.statusDanger }}>{state.error}</Text>}
    {linkError && <Text accessibilityRole="alert" style={{ ...t.muted, color: c.statusDanger }}>{linkError}</Text>}
    {expanded && <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 12 }}>
      <Text selectable style={t.muted}>PR updated {absoluteTime(pr.updatedAt)}</Text>
      {currentHead && <Text selectable style={t.mono}>Current head {currentHead}</Text>}
      <ProjectAvailability theme={theme} match={match} />
      {projects.length > 1 && <ChoicePicker label="Review project" placeholder="Select a local project" icon="Folder" t={t} size="sm"
        value={projectId} disabled={state?.busy} onChange={setSelection}
        options={projects.map((project) => ({ id: project.projectId, label: project.name, description: project.path }))} />}
      {pr.labels.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {pr.labels.map((tag) => <Text key={tag} style={{ ...t.muted, fontSize: 11, backgroundColor: c.surface2, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>{tag}</Text>)}
      </View>}
      {pr.draft && <Text style={{ ...t.muted, color: c.statusWarning }}>This run saves findings locally and cannot publish to GitHub. Start a new run after marking the PR ready if you want to publish.</Text>}
      {canLaunch && <>
        {(showInstructions || instructions.length > 0) ? <View style={{ gap: 8 }}>
          <Text style={t.label}>Extra instructions for the next run</Text>
          <TextInput accessibilityLabel="Extra instructions or context" multiline textAlignVertical="top" editable={!state?.busy}
            value={instructions} onChangeText={(value) => launcher.setInstructions(pr, value)} maxLength={MAX_REVIEW_INSTRUCTIONS_LENGTH}
            placeholder="For example: Focus on session expiry and concurrent requests."
            placeholderTextColor={c.foregroundMuted} style={{ ...t.input, minHeight: 90, lineHeight: 20 }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={t.muted}>{instructions.length.toLocaleString()} / {MAX_REVIEW_INSTRUCTIONS_LENGTH.toLocaleString()}</Text>
            <ActionButton title="Clear instructions" size="sm" t={t} disabled={state?.busy} onPress={() => { launcher.setInstructions(pr, ""); setShowInstructions(false); }} />
          </View>
        </View> : <ActionButton title="Add instructions" icon="MessageSquarePlus" size="sm" t={t} disabled={state?.busy} onPress={() => setShowInstructions(true)} />}
        {hasReview && <ActionButton title={state?.error ? "Retry review" : pr.draft ? "Review draft again locally" : "Run again"} icon="RotateCcw" size="sm" t={t}
          disabled={state?.busy || Boolean(activeAgent) || Boolean(linked.pendingCreatedAgentId) || linked.loading || Boolean(linked.error) || !projectId || !configured} onPress={start} />}
        {!configured && onOpenReviewer && <ActionButton title="Configure reviewer" icon="Settings2" size="sm" t={t} onPress={onOpenReviewer} />}
        {!configured && <Text style={t.muted}>Save a model in Reviewer setup before starting a review.</Text>}
        {activeAgent && <Text style={t.muted}>A review is already running. Open its agent to follow progress.</Text>}
      </>}
      {linked.error && <View style={{ gap: 6 }}>
        <Text accessibilityRole="alert" style={{ ...t.muted, color: c.statusWarning }}>{linked.error}</Text>
        <ActionButton title="Reload review agents" icon="RefreshCw" size="sm" t={t} disabled={linked.loading} onPress={() => void linked.refresh()} />
      </View>}
      {outcomes.error && <Text accessibilityRole="alert" style={{ ...t.muted, color: c.statusWarning }}>{outcomes.error}</Text>}
      {linked.agents.length > 0 && <View style={{ gap: 10 }}>
        <Text style={t.label}>Review history · {linked.agents.length} {linked.agents.length === 1 ? "run" : "runs"}</Text>
        {linked.agents.map((agent) => {
          const history = reviewProgress(agent, outcomes.runs, currentHead);
          return <View key={agent.id} style={{ gap: 5, padding: 10, borderRadius: 10, backgroundColor: c.surface0 }}>
            <Text style={t.strong}>{agent.title || `Agent ${agent.id.slice(0, 8)}`}</Text>
            <Text style={t.muted}>{history.label} · {agent.status} · {relativeTime(agent.updatedAt, now)}</Text>
            <Text selectable style={t.muted}>Updated {absoluteTime(agent.updatedAt)}</Text>
            {history.headSha && <Text selectable style={t.mono}>Reviewed commit {history.headSha}</Text>}
            {history.outdated && <Text style={{ ...t.muted, color: c.statusWarning }}>New commits since this review</Text>}
            {history.reason && <Text style={t.muted}>{history.reason}</Text>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {navigation ? <ActionButton title="Open agent" icon="ArrowUpRight" size="sm" t={t} onPress={() => navigation.openAgent({ agentId: agent.id })} />
                : <Text selectable style={t.mono}>Agent {agent.id}</Text>}
              {history.reviewUrl && <ActionButton title="View review" icon="ExternalLink" size="sm" t={t} onPress={() => void openReview(history.reviewUrl!)} />}
            </View>
          </View>;
        })}
      </View>}
      {linked.pendingCreatedAgentId && !linked.agents.some((agent) => agent.id === linked.pendingCreatedAgentId) && <Text selectable style={t.mono}>Agent {linked.pendingCreatedAgentId}</Text>}
      <ActionButton title="Open pull request on GitHub" icon="ExternalLink" size="sm" t={t} onPress={onOpenPR} />
      {state?.busy && <Text style={t.muted}>Fetching PR commits and creating an isolated worktree…</Text>}
    </View>}
  </View>;
}
