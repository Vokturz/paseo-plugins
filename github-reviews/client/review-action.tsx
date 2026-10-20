import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { launchReviewRpc, type LaunchReviewResult, type PullRequest } from "../shared/contracts";
import type { RepositoryProjects } from "../shared/projects";
import { ChoicePicker } from "./choice-picker";
import { tokensFor } from "./design";
import { ActionButton } from "./ui";

type LaunchState = { requestId: string; busy: boolean; result?: LaunchReviewResult; error?: string };
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
  const [, render] = useState(0);
  const key = (pr: PullRequest, projectId: string) => JSON.stringify([pr.repository, pr.number, projectId]);
  return {
    state: (pr: PullRequest, projectId: string) => states.current.get(key(pr, projectId)),
    start: async (pr: PullRequest, projectId: string) => {
      const id = key(pr, projectId);
      const prior = states.current.get(id);
      if (prior?.busy) return;
      // A retry reuses its ID; an intentional run after success gets a new ID.
      // Preserve the last agent so it remains accessible if a new run fails.
      const state: LaunchState = {
        requestId: prior && (prior.error || !prior.result) ? prior.requestId : requestId(),
        busy: true, result: prior?.result,
      };
      states.current.set(id, state);
      render((value) => value + 1);
      try {
        state.result = await launch({ repository: pr.repository, number: pr.number, projectId, requestId: state.requestId });
      } catch (error) {
        state.error = error instanceof Error ? error.message : "Could not start the review. Try again.";
      } finally {
        state.busy = false;
        render((value) => value + 1);
      }
    },
  };
}

export function ReviewAction({ pr, match, theme, layout, navigation, configured, onOpenReviewer, launcher }: {
  pr: PullRequest; match?: RepositoryProjects; configured: boolean; onOpenReviewer?: () => void;
  launcher: ReturnType<typeof useReviewLaunch>;
} & Pick<PluginSurfaceProps, "theme" | "layout" | "navigation">) {
  const [selection, setSelection] = useState("");
  const projects = match?.projects ?? [];
  const projectId = projects.length === 1 ? projects[0].projectId : projects.some((project) => project.projectId === selection) ? selection : "";
  const state = launcher.state(pr, projectId);
  const t = tokensFor(theme, layout);
  if (match?.status !== "available" || !projects.length) return null;
  return <View style={{ gap: 10, marginTop: 5 }}>
    {projects.length > 1 && <ChoicePicker label="Review project" placeholder="Select a local project" icon="Folder" t={t}
      value={projectId} disabled={state?.busy} onChange={setSelection}
      options={projects.map((project) => ({ id: project.projectId, label: project.name, description: project.path }))} />}
    {state?.result && <Text style={{ color: t.colors.statusSuccess, fontSize: 12 }}>{state.busy || state.error ? "Previous review agent available" : "Review agent started"}</Text>}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      {state?.result && navigation && <ActionButton title="Open agent" icon="ArrowUpRight" t={t} onPress={() => navigation.openAgent({ agentId: state.result!.agentId })} />}
      <ActionButton title={state?.busy ? "Starting review…" : state?.error ? "Retry review" : state?.result ? "Run again" : "Start review"} icon={state?.result ? "RotateCcw" : "Bot"} primary t={t}
        disabled={state?.busy || !projectId || !configured} onPress={() => void launcher.start(pr, projectId)} />
      {!configured && onOpenReviewer && <ActionButton title="Configure reviewer" icon="Settings2" t={t} onPress={onOpenReviewer} />}
    </View>
    {state?.result && !navigation && <Text selectable style={t.mono}>Agent: {state.result.agentId}</Text>}
    {!configured && <Text style={t.muted}>Save a model in Reviewer setup to start a review.</Text>}
    {state?.busy && <Text style={t.muted}>Fetching PR commits and creating an isolated worktree…</Text>}
    {state?.error && <Text accessibilityRole="alert" style={{ color: t.colors.statusDanger, fontSize: 13, lineHeight: 20 }}>{state.error}</Text>}
  </View>;
}
