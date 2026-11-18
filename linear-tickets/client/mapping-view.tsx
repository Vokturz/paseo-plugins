import type { PaseoProject } from "@getpaseo/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { branchesRpc } from "../shared/contracts";
import { labelMappingKey, type ProjectMapping } from "../shared/mapping";
import { ChoicePicker } from "./choice-picker";
import type { Tokens } from "./design";
import { labelDisplay, labelGroupNames, safeColor, type WorkspaceLabel } from "./label-tools";
import { Button, Callout, Divider, FieldLabel, LabelChip, SectionHeading } from "./ui";

const UNGROUPED = "\u0000ungrouped";
const shortBranch = (branch?: string) => branch ? branch.replace(/^refs\/(heads|remotes)\//, "") : "";

function projectName(projects: PaseoProject[], id: string) {
  const project = projects.find((item) => item.projectId === id);
  return project ? project.projectCustomName || project.projectDisplayName : "Project no longer in Paseo";
}

/**
 * Maps Linear labels to the Paseo project (and base branch) a ticket should open in. Teams that
 * label tickets by the part of the system they touch get the right repository preselected; the
 * view works with any label or group, so it fits whichever labelling scheme a workspace uses.
 */
export function MappingView({ t, projects, labels, labelsLoading, labelsError, onRetryLabels, mappings, onSave, onForget, onBack, disabled }: {
  t: Tokens; projects: PaseoProject[]; labels: WorkspaceLabel[]; labelsLoading: boolean; labelsError: string | null; onRetryLabels: () => void;
  mappings: Record<string, ProjectMapping>;
  onSave: (key: string, mapping: ProjectMapping) => Promise<void>; onForget: (key: string) => Promise<void>; onBack: () => void; disabled: boolean;
}) {
  const getBranches = useRpc(branchesRpc);
  const groups = labelGroupNames(labels);
  const hasUngrouped = labels.some((item) => !item.groupName);
  const mappedCount = (group: string) => labels.filter((item) => (group === UNGROUPED ? !item.groupName : item.groupName === group) && mappings[labelMappingKey(item.id)]).length;
  // Start on the group that already holds mappings, so returning users land where they left off.
  const initialGroup = useMemo(() => [...groups, ...(hasUngrouped ? [UNGROUPED] : [])].sort((a, b) => mappedCount(b) - mappedCount(a))[0] ?? UNGROUPED,
    [labels.length]); // recomputed when the labels arrive, not on every mapping change
  const [group, setGroup] = useState<string>(initialGroup);
  useEffect(() => { setGroup(initialGroup); }, [initialGroup]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<{ id: string; label: string }[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const project = projects.find((item) => item.projectId === projectId);
  useEffect(() => {
    let cancelled = false;
    setBranches([]); setBranchesError(null);
    if (!project || project.projectKind !== "git") { setBranchesLoading(false); return; }
    setBranchesLoading(true);
    void getBranches({ projectId: project.projectId }).then((result) => {
      if (cancelled) return;
      setBranches(result.branches);
      setBranch((current) => current && result.branches.some((item) => item.id === current) ? current : result.defaultBranch ?? "");
    }, (error) => { if (!cancelled) setBranchesError(error instanceof Error ? error.message : "Branches could not be loaded."); })
      .finally(() => { if (!cancelled) setBranchesLoading(false); });
    return () => { cancelled = true; };
  }, [project?.projectId, project?.projectKind, getBranches]);

  const term = search.trim().toLowerCase();
  const rows = labels.filter((item) => (group === UNGROUPED ? !item.groupName : item.groupName === group) && (!term || `${item.name} ${item.team ?? ""}`.toLowerCase().includes(term)));
  // A label name that exists in several teams is shown with its team so the rows stay distinguishable.
  const duplicated = new Set(rows.map((item) => item.name).filter((name, index, all) => all.indexOf(name) !== index));
  const otherMappings = Object.entries(mappings).filter(([key]) => !key.startsWith("label:")).sort((a, b) => a[1].label.localeCompare(b[1].label));
  const orphaned = Object.entries(mappings).filter(([key]) => key.startsWith("label:") && !labels.some((item) => labelMappingKey(item.id) === key));

  const startEdit = (item: WorkspaceLabel) => {
    const saved = mappings[labelMappingKey(item.id)];
    setEditing(item.id); setSaveError(null);
    setProjectId(saved && projects.some((p) => p.projectId === saved.projectId) ? saved.projectId : "");
    setBranch(saved?.baseBranch ?? "");
  };
  const save = (item: WorkspaceLabel) => {
    if (!project) return;
    setSaveError(null);
    const mapping: ProjectMapping = { projectId: project.projectId, label: labelDisplay(item) + (duplicated.has(item.name) && item.team ? ` (${item.team})` : ""), ...(project.projectKind === "git" && branch ? { baseBranch: branch } : {}) };
    void onSave(labelMappingKey(item.id), mapping).then(() => setEditing(null), (error) => setSaveError(error instanceof Error ? error.message : "The mapping could not be saved."));
  };

  return <View style={{ ...t.card, gap: 14 }}>
    <SectionHeading title="Repository mappings" subtitle="Choose which Paseo project and base branch a ticket opens in." icon="FolderGit2" t={t} />
    <Text style={t.muted}>A ticket with a mapped label opens in that label’s project first. Use the labels that say which part of your system a ticket touches. When labels disagree or none are mapped, the Linear project mapping is used, then the team mapping. Those two are remembered when you start an agent.</Text>
    {labelsError && <Callout t={t} tone="danger" message={`Labels could not be loaded: ${labelsError}`} action={<Button title="Retry" icon="RefreshCw" size="sm" onPress={onRetryLabels} />} />}
    {labelsLoading && <ActivityIndicator color={t.colors.accent} />}
    {!labelsLoading && !labels.length && !labelsError && <Callout t={t} tone="info" message="This workspace has no labels yet." />}
    {!!labels.length && <>
      <FieldLabel title="Label group" icon="Tags" t={t} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {groups.map((name) => <Button key={name} size="sm" title={`${name}${mappedCount(name) ? ` · ${mappedCount(name)}` : ""}`} chosen={group === name} onPress={() => { setGroup(name); setEditing(null); }} />)}
        {hasUngrouped && <Button size="sm" title={`Ungrouped labels${mappedCount(UNGROUPED) ? ` · ${mappedCount(UNGROUPED)}` : ""}`} chosen={group === UNGROUPED} onPress={() => { setGroup(UNGROUPED); setEditing(null); }} />}
      </View>
      <View style={{ ...t.input, paddingVertical: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="Search" size={15} color={t.colors.foregroundMuted} />
        <TextInput accessibilityLabel="Search labels" value={search} onChangeText={setSearch} placeholder="Search labels…" placeholderTextColor={t.colors.foregroundMuted} style={{ color: t.colors.foreground, paddingVertical: 10, fontSize: 14, flex: 1, minWidth: 0 }} />
      </View>
      <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 12, overflow: "hidden" }}>
        {rows.map((item, index) => {
          const saved = mappings[labelMappingKey(item.id)];
          const open = editing === item.id;
          return <View key={item.id} style={{ borderTopWidth: index ? 1 : 0, borderTopColor: t.colors.border, padding: 12, gap: 10, backgroundColor: open ? t.colors.surface2 : t.colors.surface1 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 160, flex: 1 }}>
                <LabelChip label={item.name} color={safeColor(item.color)} t={t} />
                {duplicated.has(item.name) && <Text style={t.muted}>{item.team || "Workspace"}</Text>}
              </View>
              <Text numberOfLines={1} style={{ ...(saved ? t.strong : t.muted), flex: 1, minWidth: 140 }}>{saved ? `→ ${projectName(projects, saved.projectId)}${saved.baseBranch ? ` · ${shortBranch(saved.baseBranch)}` : ""}` : "Not mapped"}</Text>
              <Button size="sm" title={open ? "Cancel" : saved ? "Change" : "Map"} icon={open ? "X" : "PenLine"} disabled={disabled} onPress={() => open ? setEditing(null) : startEdit(item)} />
              {saved && !open && <Button size="sm" title="Forget" icon="Trash2" tone="danger" disabled={disabled} onPress={() => void onForget(labelMappingKey(item.id))} />}
            </View>
            {open && <View style={{ gap: 8 }}>
              <ChoicePicker label="Projects" icon="Folder" placeholder="Choose a Paseo project" value={projectId} t={t} disabled={disabled}
                options={projects.map((item) => ({ id: item.projectId, label: item.projectCustomName || item.projectDisplayName, description: item.projectRootPath }))}
                onChange={(id) => { setProjectId(id); setBranch(""); }} />
              {project?.projectKind === "git" && <>
                <ChoicePicker label="Branches" icon="GitBranch" placeholder={branchesLoading ? "Loading branches…" : "Repository default branch"} value={branch} options={branches} onChange={setBranch} t={t} disabled={disabled || branchesLoading} />
                {branchesError && <Callout t={t} tone="danger" message={branchesError} />}
              </>}
              {saveError && <Callout t={t} tone="danger" message={saveError} />}
              <Button title="Save mapping" icon="Check" primary disabled={disabled || !project || branchesLoading} onPress={() => save(item)} />
            </View>}
          </View>;
        })}
        {!rows.length && <Text style={{ ...t.muted, padding: 12 }}>No labels match.</Text>}
      </View>
    </>}
    {!!orphaned.length && <>
      <FieldLabel title="Mappings for labels no longer visible" icon="TriangleAlert" t={t} />
      {orphaned.map(([key, mapping]) => <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Text style={{ ...t.strong, flex: 1, minWidth: 160 }} numberOfLines={1}>{mapping.label} → {projectName(projects, mapping.projectId)}</Text>
        <Button title="Forget" icon="X" size="sm" disabled={disabled} onPress={() => void onForget(key)} />
      </View>)}
    </>}
    <Divider t={t} spaced />
    <FieldLabel title="Linear projects and teams" icon="Folder" hint="remembered from launches" t={t} />
    {otherMappings.length ? otherMappings.map(([key, mapping]) => <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Text style={{ ...t.strong, flex: 1, minWidth: 160 }} numberOfLines={1}>{mapping.label} → {projectName(projects, mapping.projectId)}{mapping.baseBranch ? ` · ${shortBranch(mapping.baseBranch)}` : ""}</Text>
      <Button title="Forget" icon="X" size="sm" disabled={disabled} onPress={() => void onForget(key)} />
    </View>) : <Text style={t.muted}>None yet. Starting an agent from a ticket remembers its project and base branch for that Linear project. Until then, a Paseo project with the same name is preselected.</Text>}
    <Button title="Back" icon="ArrowLeft" size="sm" onPress={onBack} />
  </View>;
}
