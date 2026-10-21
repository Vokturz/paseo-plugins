import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { launchReviewRpc, MAX_REVIEW_INSTRUCTIONS_LENGTH, type LaunchReviewResult, type PullRequest } from "../shared/contracts";
import type { RepositoryProjects } from "../shared/projects";
import { ChoicePicker } from "./choice-picker";
import { tokensFor } from "./design";
import { ActionButton } from "./ui";
import { useReviewAgents } from "./use-review-agents";
import { useReviewOutcomes } from "./use-review-outcomes";
import { reviewProgress } from "./review-outcomes";

type LaunchState = { requestId: string; instructions: string; busy: boolean; result?: LaunchReviewResult; error?: string };
function requestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 3) | 8).toString(16);
  });
}

// Keep request IDs and outcomes across pagination, refreshes, and tab changes.
export function useReviewLaunch() {
  const launch = useRpc(launchReviewRpc);
  const states = useRef(new Map<string, LaunchState>());
  const drafts = useRef(new Map<string, string>());
  const [, render] = useState(0);
  const draftKey = (pr: PullRequest) => JSON.stringify([pr.repository, pr.number]);
  const key = (pr: PullRequest, projectId: string) => JSON.stringify([pr.repository, pr.number, projectId]);
  return {
    instructions: (pr: PullRequest) => drafts.current.get(draftKey(pr)) ?? "",
    setInstructions: (pr: PullRequest, value: string) => {
      drafts.current.set(draftKey(pr), value);
      render((value) => value + 1);
    },
    state: (pr: PullRequest, projectId: string) => states.current.get(key(pr, projectId)),
    start: async (pr: PullRequest, projectId: string) => {
      const id = key(pr, projectId);
      const prior = states.current.get(id);
      if (prior?.busy) return;
      const instructions = (drafts.current.get(draftKey(pr)) ?? "").trim();
      // A retry reuses its ID; an intentional run after success gets a new ID.
      // Preserve the last agent so it remains accessible if a new run fails.
      const state: LaunchState = {
        requestId: prior && prior.instructions === instructions && (prior.error || !prior.result) ? prior.requestId : requestId(),
        instructions, busy: true, result: prior?.result,
      };
      states.current.set(id, state);
      render((value) => value + 1);
      try {
        state.result = await launch({ repository: pr.repository, number: pr.number, projectId, requestId: state.requestId, instructions });
      } catch (error) {
        state.error = error instanceof Error ? error.message : "Could not start the review. Try again.";
      } finally {
        state.busy = false;
        render((value) => value + 1);
      }
    },
  };
}

export function ReviewAction({ pr, match, theme, layout, navigation, configured, onOpenReviewer, launcher, currentHead }: {
  pr: PullRequest; match?: RepositoryProjects; configured: boolean; onOpenReviewer?: () => void;
  currentHead?: string | null;
  launcher: ReturnType<typeof useReviewLaunch>;
} & Pick<PluginSurfaceProps, "theme" | "layout" | "navigation">) {
  const [selection, setSelection] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const instructions = launcher.instructions(pr);
  const projects = match?.projects ?? [];
  const projectId = projects.length === 1 ? projects[0].projectId : projects.some((project) => project.projectId === selection) ? selection : "";
  const state = launcher.state(pr, projectId);
  const linked = useReviewAgents(pr, state?.result?.agentId);
  const outcomes = useReviewOutcomes(pr, linked.agents.map((agent) => `${agent.id}:${agent.status}`).join(","));
  const [reviewLinkError, setReviewLinkError] = useState<string | null>(null);
  const hasReview = Boolean(state?.result || linked.agents.length);
  const canLaunch = match?.status === "available" && projects.length > 0;
  const t = tokensFor(theme, layout);
  if (!canLaunch && !linked.agents.length && !linked.error) return null;
  return <View style={{ gap: 10, marginTop: 5 }}>
    {projects.length > 1 && <ChoicePicker label="Review project" placeholder="Select a local project" icon="Folder" t={t}
      value={projectId} disabled={state?.busy} onChange={setSelection}
      options={projects.map((project) => ({ id: project.projectId, label: project.name, description: project.path }))} />}
    {(showInstructions || instructions.length > 0) && <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
        <Text style={t.label}>Extra instructions or context (optional)</Text>
        <ActionButton title="Clear instructions" size="sm" t={t} disabled={state?.busy}
          onPress={() => { launcher.setInstructions(pr, ""); setShowInstructions(false); }} />
      </View>
      <TextInput accessibilityLabel="Extra instructions or context" multiline textAlignVertical="top" editable={!state?.busy}
        value={instructions} onChangeText={(value) => launcher.setInstructions(pr, value)} maxLength={MAX_REVIEW_INSTRUCTIONS_LENGTH}
        placeholder="For example: Look closely at session expiry and concurrent requests. Include the retry behavior in your review."
        placeholderTextColor={t.colors.foregroundMuted} style={{ ...t.input, minHeight: 110, lineHeight: 21, opacity: state?.busy ? 0.6 : 1 }} />
      <Text style={t.muted}>Added to the saved review prompt for this run. {instructions.length.toLocaleString()} / {MAX_REVIEW_INSTRUCTIONS_LENGTH.toLocaleString()}</Text>
    </View>}
    {linked.agents.length > 0 && <View style={{ gap: 8 }}>
      <Text style={t.label}>Paseo agents · {linked.agents.length} linked</Text>
      {linked.agents.map((agent) => { const progress = reviewProgress(agent, outcomes.runs, currentHead); return <View key={agent.id} style={{ gap: 7, paddingVertical: 6 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 130, gap: 2 }}>
          <Text numberOfLines={1} style={t.strong}>{agent.title || `Agent ${agent.id.slice(0, 8)}`}</Text>
          <Text style={t.muted}>{agent.status} · {new Date(agent.updatedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</Text>
        </View>
        {navigation ? <ActionButton title="Open agent" icon="ArrowUpRight" size="sm" t={t} onPress={() => navigation.openAgent({ agentId: agent.id })} />
          : <Text selectable style={t.mono}>Agent: {agent.id}</Text>}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text style={{ color: progress.status === "published" ? t.colors.statusSuccess : progress.status === "blocked" ? t.colors.statusWarning : t.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{progress.label}</Text>
          {progress.headSha && <Text style={t.mono}>Commit {progress.headSha.slice(0, 7)}</Text>}
          {progress.outdated && <Text style={{ color: t.colors.statusWarning, fontSize: 12, fontWeight: "600" }}>New commits since review</Text>}
        </View>
        {progress.reason && <Text style={t.muted}>{progress.reason}</Text>}
        {progress.reviewUrl && <ActionButton title="View GitHub review" icon="ExternalLink" size="sm" t={t} onPress={() => {
          setReviewLinkError(null);
          void openExternalUrl(progress.reviewUrl!).catch(() => setReviewLinkError("Could not open the GitHub review. Try again."));
        }} />}
      </View>; })}
      {outcomes.error && <Text style={{ ...t.muted, color: t.colors.statusWarning }}>{outcomes.error}</Text>}
      {reviewLinkError && <Text accessibilityRole="alert" style={{ ...t.muted, color: t.colors.statusWarning }}>{reviewLinkError}</Text>}
    </View>}
    {linked.error && <View style={{ gap: 7 }}>
      <Text accessibilityRole="alert" style={{ color: t.colors.statusWarning, fontSize: 12 }}>{linked.error}</Text>
      <ActionButton title="Reload review agents" icon="RefreshCw" t={t} disabled={linked.loading} onPress={() => void linked.refresh()} />
    </View>}
    {state?.result && !linked.error && linked.agents.some((agent) => agent.id === state.result!.agentId) && <Text style={{ color: t.colors.statusSuccess, fontSize: 12 }}>{state.busy || state.error ? "Previous review agent available" : "Review agent started"}</Text>}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <ActionButton title={state?.busy ? "Starting review…" : state?.error ? "Retry review" : hasReview ? "Run again" : "Start review"} icon={hasReview ? "RotateCcw" : "Bot"} primary t={t}
        disabled={state?.busy || !projectId || !configured || !canLaunch} onPress={() => void launcher.start(pr, projectId)} />
      {!showInstructions && !instructions.length && <ActionButton title="Add instructions" icon="MessageSquarePlus" t={t} disabled={state?.busy} onPress={() => setShowInstructions(true)} />}
      {!configured && onOpenReviewer && <ActionButton title="Configure reviewer" icon="Settings2" t={t} onPress={onOpenReviewer} />}
    </View>
    {!configured && <Text style={t.muted}>Save a model in Reviewer setup to start a review.</Text>}
    {state?.busy && <Text style={t.muted}>Fetching PR commits and creating an isolated worktree…</Text>}
    {state?.error && <Text accessibilityRole="alert" style={{ color: t.colors.statusDanger, fontSize: 13, lineHeight: 20 }}>{state.error}</Text>}
  </View>;
}
