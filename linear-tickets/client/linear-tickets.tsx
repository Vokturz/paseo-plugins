import type { PaseoProject } from "@getpaseo/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { branchesRpc, connectRpc, issueContextRpc, disconnectRpc, listIssuesRpc, launchAgentRpc, statusRpc, type Issue, type TicketDetail } from "../shared/contracts";
import { filterIssues, formatIssueDate, issueStatus, statusCounts, type DateDirection, type DateField } from "./issue-list";

import { ChoicePicker } from "./choice-picker";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { ActionButton, FieldLabel, ProviderMark, SectionHeading, StatusBadge } from "./ui";
import { MarkdownPreview } from "./markdown-preview";

type ThinkingOption = { id: string; label: string; description?: string; isDefault?: boolean };
type ModelChoice = { id: string; label: string; provider: string; description?: string; thinkingOptions: ThinkingOption[]; defaultThinkingOptionId?: string };
type ModeChoice = { id: string; label: string; description?: string; icon?: string };

function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
// Used only for request deduplication, never as a security token.
function requestId() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = Math.floor(Math.random() * 16); return (c === "x" ? r : (r & 3) | 8).toString(16);
}); }

export function LinearTicketsSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const getBranches = useRpc(branchesRpc);
  const getStatus = useRpc(statusRpc), connect = useRpc(connectRpc), disconnect = useRpc(disconnectRpc);
  const getIssues = useRpc(listIssuesRpc), getDetail = useRpc(issueContextRpc), start = useRpc(launchAgentRpc);
  const [connection, setConnection] = useState<{ connected: boolean; source: "none" | "saved" | "environment" } | null>(null);
  const [key, setKey] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [dateField, setDateField] = useState<DateField>("updatedAt");
  const [dateDirection, setDateDirection] = useState<DateDirection>("newest");
  const [manageConnection, setManageConnection] = useState(false);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [projects, setProjects] = useState<PaseoProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [branches, setBranches] = useState<{ id: string; label: string }[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branchesVersion, setBranchesVersion] = useState(0);
  const [providerGroup, setProviderGroup] = useState("");
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [modes, setModes] = useState<Record<string, ModeChoice[]>>({});
  const [provider, setProvider] = useState("");
  const [modeId, setModeId] = useState("");
  const [thinkingOptionId, setThinkingOptionId] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<{ agentId: string; warnings: string[] } | null>(null);
  const launchRequest = useRef<{ fingerprint: string; id: string } | null>(null);

  const run = async (label: string, task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null);
    try { await task(); } catch (error) { setError(message(error)); }
    finally { busyRef.current = false; setBusy(null); }
  };

  const loadIssues = useCallback(async (next?: string) => {
    const page = await getIssues(next ? { cursor: next } : {});
    if (next && page.nextCursor === next) throw new Error("Linear repeated a page. Refresh the ticket list to continue.");
    setIssues((previous) => [...new Map((next ? [...previous, ...page.issues] : page.issues).map((issue) => [issue.id, issue])).values()]);
    setCursor(page.nextCursor);
    return page.nextCursor;
  }, [getIssues]);

  const loadAllIssues = async () => {
    let next = cursor;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next)) throw new Error("Linear repeated a page. Refresh tickets to continue.");
      seen.add(next);
      next = await loadIssues(next);
    }
  };

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true); setOptionsError(null);
    try {
      const [spaces, choices] = await Promise.all([
        paseo.projects.list().then((result) => result.projects),
        (async () => {
          const available = await paseo.providers.listAvailable();
          if (available.error) throw new Error(available.error);
          const results = await Promise.allSettled(available.providers.filter((p) => p.available).map(async (p) => {
            const [modelResult, modeResult] = await Promise.allSettled([paseo.providers.listModels(p.provider), paseo.providers.listModes(p.provider)]);
            if (modelResult.status === "rejected") throw modelResult.reason;
            if (modelResult.value.error) throw new Error(modelResult.value.error);
            const models = (modelResult.value.models ?? []).filter((model) => model.isSelectable !== false).map((model) => ({
              id: `${p.provider}/${model.id}`, label: model.label, provider: p.provider, description: model.description,
              thinkingOptions: model.thinkingOptions ?? [], defaultThinkingOptionId: model.defaultThinkingOptionId,
            }));
            if (modeResult.status === "rejected" || modeResult.value.error) return { provider: p.provider, models, modes: [] };
            return { provider: p.provider, models, modes: (modeResult.value.modes ?? []).map((mode) => ({ id: mode.id, label: mode.label, description: mode.description, icon: mode.icon })) };
          }));
          const models = results.flatMap((result) => result.status === "fulfilled" ? result.value.models : []);
          const modes = Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.provider, result.value.modes]] : []));
          if (results.some((result) => result.status === "rejected")) setOptionsError("Some agent models could not be loaded. Retry to refresh them.");
          return { models, modes };
        })(),
      ]);
      setProjects(spaces); setModels(choices.models); setModes(choices.modes);
      setProjectId((current) => spaces.some((p) => p.projectId === current) ? current : "");
      setProviderGroup((current) => choices.models.some((m) => m.provider === current) ? current : "");
      setProvider((current) => choices.models.some((m) => m.id === current) ? current : "");
    } catch (error) { setOptionsError(message(error)); }
    finally { setOptionsLoading(false); }
  }, [paseo]);

  useEffect(() => {
    void run("Loading connection", async () => {
      const status = await getStatus({}); setConnection(status);
      if (status.connected) await loadIssues();
    });
    void loadOptions();
  }, [getStatus, loadIssues, loadOptions]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null); setDetailError(null); setShowContext(false);
    if (!selected) { setDetailLoading(false); return; }
    setDetailLoading(true);
    void getDetail({ id: selected.id }).then((value) => {
      if (!cancelled) setDetail(value);
    }, (error) => { if (!cancelled) setDetailError(message(error)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected, getDetail, detailVersion]);

  const project = projects.find((item) => item.projectId === projectId);
  useEffect(() => {
    let cancelled = false;
    setBranches([]); setBaseBranch(""); setBranchesError(null);
    if (!project || project.projectKind !== "git") { setBranchesLoading(false); return; }
    setBranchesLoading(true);
    void getBranches({ projectId: project.projectId }).then((result) => {
      if (!cancelled) { setBranches(result.branches); setBaseBranch(result.defaultBranch ?? ""); }
    }, (error) => { if (!cancelled) setBranchesError(message(error)); })
      .finally(() => { if (!cancelled) setBranchesLoading(false); });
    return () => { cancelled = true; };
  }, [project?.projectId, project?.projectKind, project?.projectRootPath, getBranches, branchesVersion]);
  const providerGroups = [...new Set(models.map((model) => model.provider))];
  const selectedModel = models.find((model) => model.id === provider);
  const activeModes = modes[providerGroup] ?? [];
  const thinkingOptions = selectedModel?.thinkingOptions ?? [];
  useEffect(() => {
    if (modeId && !activeModes.some((mode) => mode.id === modeId)) setModeId("");
  }, [activeModes, modeId]);
  useEffect(() => {
    if (!thinkingOptions.length) { if (thinkingOptionId) setThinkingOptionId(""); return; }
    if (!thinkingOptions.some((option) => option.id === thinkingOptionId)) {
      setThinkingOptionId(selectedModel?.defaultThinkingOptionId ?? thinkingOptions.find((option) => option.isDefault)?.id ?? "");
    }
  }, [selectedModel?.defaultThinkingOptionId, provider, thinkingOptionId, thinkingOptions]);
  const canLaunch = Boolean(detail && project && provider && !optionsLoading && !branchesLoading
    && (project.projectKind !== "git" || (baseBranch && !branchesError)));

  const colors = theme.colors;
  const styles = {
    content: { padding: layout.compact ? 16 : 32, gap: 22, width: "100%" as const, maxWidth: 1280, alignSelf: "center" as const },
    row: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 8 },
    card: { backgroundColor: colors.surface1, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: layout.compact ? 18 : 24, gap: 12 },
    detailLayout: { flexDirection: layout.compact ? "column" as const : "row" as const, alignItems: "flex-start" as const, gap: 22 },
    text: { color: colors.foreground, fontSize: 14, lineHeight: 24 },
    muted: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 },
    heading: { color: colors.foreground, fontSize: 18, fontWeight: "700" as const },
    input: { color: colors.foreground, backgroundColor: colors.surface0, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
    error: { color: colors.statusDanger, fontSize: 13, lineHeight: 20 },
  };
  const Button = (props: { title: string; icon?: string; leading?: ReactNode; onPress: () => void; primary?: boolean; disabled?: boolean; chosen?: boolean }) => (
    <ActionButton {...props} theme={theme} disabled={props.disabled || Boolean(busy)} />
  );

  const visible = filterIssues(issues, query, status, dateField, dateDirection);
  const statuses = statusCounts(issues);
  // Keep a selected filter visible even when a refresh removes its last ticket.
  if (status && !statuses.some(([name]) => name === status)) statuses.push([status, 0]);
  const choose = (issue: Issue) => {
    setSelected(issue); setAgent(null); setError(null); setInstructions(""); launchRequest.current = null;
  };
  const launch = () => void run("Starting agent", async () => {
    if (!selected || !canLaunch) return;
    const fingerprint = JSON.stringify([selected.id, projectId, baseBranch, provider, modeId, thinkingOptionId, instructions]);
    if (launchRequest.current?.fingerprint !== fingerprint) launchRequest.current = { fingerprint, id: requestId() };
    const result = await start({ id: selected.id, projectId, baseBranch: project?.projectKind === "git" ? baseBranch : undefined, provider, modeId: modeId || undefined, thinkingOptionId: thinkingOptionId || undefined, instructions, requestId: launchRequest.current.id });
    setAgent(result);
  });

  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={styles.content}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 18, paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, flex: 1, minWidth: 230 }}>
        <View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
          <Icon name="Ticket" size={26} color={colors.accentForeground} />
        </View>
        <View style={{ gap: 4, flex: 1 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 10, fontWeight: "700", letterSpacing: 2 }}>LINEAR / MY WORK</Text>
          <Text style={{ color: colors.foreground, fontSize: layout.compact ? 24 : 29, fontWeight: "700", letterSpacing: -0.7 }}>Linear tickets</Text>
          <Text style={styles.muted}>{selected ? "A little context. A clear starting point." : "Your next idea, fix, or feature starts here."}</Text>
        </View>
      </View>
      {connection?.connected && <View style={styles.row}>
        <Button title="Connection" icon="Plug" chosen={manageConnection} onPress={() => setManageConnection(!manageConnection)} />
        <Button title="Refresh" icon="RefreshCw" onPress={() => void run("Refreshing tickets", async () => { await loadIssues(); })} />
      </View>}
    </View>
    {busy && <View style={styles.row}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{busy}…</Text></View>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

    {!connection?.connected ? <View style={styles.card}>
      <SectionHeading title="Connect your work" subtitle="Bring your assigned Linear tickets into Paseo." icon="Plug" theme={theme} />
      <Text style={styles.text}>Create a personal API key in Linear → Settings → Security & access, then paste it below.</Text>
      <Text style={styles.muted}>The connection is shared by clients on this Paseo host. Your key is saved privately on the host.</Text>
      <Text style={styles.muted}>A key with Read permission is enough. You can also set LINEAR_API_KEY in the daemon environment and restart it.</Text>
      <TextInput accessibilityLabel="Linear API key" secureTextEntry autoCapitalize="none" autoCorrect={false} value={key} onChangeText={setKey} placeholder="Linear API key" placeholderTextColor={colors.foregroundMuted} style={styles.input} />
      <Button icon="Plug" title="Connect Linear" primary disabled={!key.trim()} onPress={() => void run("Connecting Linear", async () => {
        setConnection(await connect({ apiKey: key.trim() })); setKey(""); await loadIssues();
      })} />
      <Button icon="RefreshCw" title="Retry saved connection" onPress={() => void run("Loading connection", async () => {
        const status = await getStatus({}); setConnection(status);
        if (status.connected) await loadIssues();
      })} />
    </View> : <>
      {manageConnection && <View style={styles.row}>
        <Text style={styles.muted}>Connected to Linear{connection.source === "environment" ? " through the host environment" : ""}</Text>
        {connection.source !== "environment" && <Button icon="Unplug" title="Disconnect" onPress={() => void run("Disconnecting", async () => {
          setConnection(await disconnect({})); setIssues([]); setSelected(null); setAgent(null); setCursor(null); setStatus(null); setQuery("");
        })} />}
      </View>}
      {selected ? <>
        <View style={styles.row}>
          <Button icon="ArrowLeft" title="Assigned tickets" onPress={() => { setSelected(null); setAgent(null); setError(null); }} />
          {/^https:\/\/linear\.app\//.test(selected.url) && <Button icon="ExternalLink" title="Open in Linear" onPress={() => void run("Opening Linear", async () => { await Linking.openURL(selected.url); })} />}
        </View>
        <View style={styles.detailLayout}>
        <View style={{ ...styles.card, flex: layout.compact ? undefined : 1.15, width: layout.compact ? "100%" : undefined, minWidth: 0, borderTopWidth: 3, borderTopColor: colors.accent }}>
          <View style={{ ...styles.row, justifyContent: "space-between", marginBottom: 6 }}>
            <View style={styles.row}><Icon name="Ticket" size={15} color={colors.accent} /><Text style={{ ...styles.muted, color: colors.accent, fontWeight: "700" }}>{selected.identifier}</Text></View>
            <StatusBadge status={(detail?.issue ?? selected).status} theme={theme} />
          </View>
          <Text style={{ ...styles.heading, fontSize: 23, lineHeight: 32, letterSpacing: -0.4 }}>{(detail?.issue ?? selected).title}</Text>
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          {detailLoading && <ActivityIndicator color={colors.accent} />}
          {detailError && <><Text style={styles.error}>{detailError}</Text><Button icon="RefreshCw" title="Retry ticket details" onPress={() => setDetailVersion((value) => value + 1)} /></>}
          {detail && <>
            <MarkdownPreview markdown={detail.issue.description || "No description provided."} theme={theme} />
            {detail.warnings.map((warning) => <Text key={warning} style={styles.error}>{warning}</Text>)}
            <Button icon="FileText" title={showContext ? "Hide agent context" : "Preview agent context"} onPress={() => setShowContext(!showContext)} />
            {showContext && <ScrollView style={{ maxHeight: 320, backgroundColor: colors.surface0, borderRadius: 10 }} contentContainerStyle={{ padding: 14 }} nestedScrollEnabled><Text selectable style={{ ...styles.muted, fontFamily: "monospace", fontSize: 11 }}>{detail.context}</Text></ScrollView>}
          </>}
        </View>
        {agent ? <View style={{ ...styles.card, flex: layout.compact ? undefined : 1, width: layout.compact ? "100%" : undefined, minWidth: 0 }}>
          <SectionHeading title="Off to a good start" subtitle="Your agent is ready to work." icon="CheckCircle" theme={theme} />
          <Text style={styles.text}>The ticket snapshot is included in the agent’s first prompt.</Text>
          {agent.warnings.map((warning) => <Text key={warning} style={styles.error}>{warning}</Text>)}
          {navigation ? <Button icon="ArrowUpRight" title="Open agent" primary onPress={() => navigation.openAgent({ agentId: agent.agentId })} /> : <Text selectable style={styles.muted}>Agent ID: {agent.agentId}</Text>}
        </View> : <View style={{ ...styles.card, flex: layout.compact ? undefined : 1, width: layout.compact ? "100%" : undefined, minWidth: 0 }}>
          <SectionHeading title="Set your agent up" subtitle="Choose where it works and who takes the lead." icon="Bot" theme={theme} />
          {optionsLoading && <ActivityIndicator color={colors.accent} />}
          {optionsError && <Text style={styles.error}>{optionsError}</Text>}
          <FieldLabel title="Project" icon="Folder" theme={theme} />
          <ChoicePicker label="Projects" placeholder="Choose a project" options={projects.map((item) => ({ id: item.projectId, label: item.projectCustomName || item.projectDisplayName, description: item.projectRootPath }))}
            value={projectId} onChange={(id) => { if (id !== projectId) { setProjectId(id); setBaseBranch(""); setBranches([]); } }} theme={theme} disabled={Boolean(busy) || optionsLoading} />
          {!optionsLoading && !projects.length && <Text style={styles.muted}>Open a project in Paseo, then reload the choices.</Text>}
          {project?.projectKind === "git" && <>
            <FieldLabel title="Base branch" icon="GitBranch" theme={theme} />
            {branchesLoading && <ActivityIndicator color={colors.accent} />}
            {branchesError && <Text style={styles.error}>{branchesError}</Text>}
            <ChoicePicker key={projectId} label="Branches" placeholder="Choose a base branch" options={branches} value={baseBranch} onChange={setBaseBranch} theme={theme} disabled={Boolean(busy) || branchesLoading} />
            <Text style={styles.muted}>Creates a new ticket branch in its own worktree, starting from this branch. Remote branches use the locally fetched version.</Text>
            {!branchesLoading && !branches.length && !branchesError && <Text style={styles.muted}>No branches found. The repository needs at least one commit.</Text>}
            <Button icon="RefreshCw" title="Refresh branches" disabled={branchesLoading} onPress={() => setBranchesVersion((value) => value + 1)} />
          </>}
          {project && project.projectKind !== "git" && <Text style={styles.muted}>The agent will work in this project’s directory.</Text>}
          <View style={{ height: 1, backgroundColor: colors.border, marginTop: 12 }} />
          <FieldLabel title="Provider" icon="Bot" theme={theme} />
          <View style={styles.row}>{providerGroups.map((group) => <Button key={group} leading={<ProviderMark provider={group} theme={theme} size={15} />} title={`${group} · ${models.filter((model) => model.provider === group).length}`} chosen={providerGroup === group}
            onPress={() => { if (group !== providerGroup) { setProviderGroup(group); setProvider(""); setModeId(""); setThinkingOptionId(""); } }} />)}</View>
          {!optionsLoading && !models.length && <Text style={styles.muted}>Configure an agent provider in Paseo, then reload the choices.</Text>}
          {providerGroup && <>
            <FieldLabel title="Model" icon="Cpu" theme={theme} />
            <ChoicePicker key={providerGroup} label="Models" placeholder="Choose a model" options={models.filter((model) => model.provider === providerGroup)} value={provider} onChange={(id) => {
              const model = models.find((candidate) => candidate.id === id);
              setProvider(id); setThinkingOptionId(model?.defaultThinkingOptionId ?? model?.thinkingOptions.find((option) => option.isDefault)?.id ?? "");
            }} leading={<ProviderMark provider={providerGroup} theme={theme} size={15} />} theme={theme} disabled={Boolean(busy)} />
            {!!activeModes.length && <>
              <FieldLabel title="Change mode" icon="SlidersHorizontal" theme={theme} />
              <ChoicePicker key={`${providerGroup}-modes`} label="Modes" placeholder="Use provider default" options={[{ id: "", label: "Provider default", description: "Use the default mode configured in Paseo." }, ...activeModes]} value={modeId} onChange={setModeId} theme={theme} disabled={Boolean(busy)} />
            </>}
            {!!thinkingOptions.length && <>
              <FieldLabel title="Reasoning" icon="BrainCircuit" theme={theme} />
              <ChoicePicker key={`${provider}-thinking`} label="Reasoning" placeholder="Choose a reasoning level" options={thinkingOptions} value={thinkingOptionId} onChange={setThinkingOptionId} theme={theme} disabled={Boolean(busy)} />
              <Text style={styles.muted}>Available reasoning levels come directly from this model’s Paseo provider.</Text>
            </>}
          </>}
          <Button icon="RefreshCw" title="Reload projects and models" disabled={optionsLoading} onPress={() => void loadOptions()} />
          <FieldLabel title="A little extra direction" icon="MessageSquare" theme={theme} />
          <TextInput accessibilityLabel="Additional instructions for the agent" editable={!busy} multiline maxLength={10000} value={instructions} onChangeText={setInstructions}
            placeholder="Additional instructions (optional)" placeholderTextColor={colors.foregroundMuted} style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18, marginTop: 8, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon name={canLaunch ? "CheckCircle" : "Circle"} size={14} color={canLaunch ? colors.statusSuccess : colors.foregroundMuted} />
              <Text style={styles.muted}>{canLaunch ? "Ticket context included. Ready when you are." : "Choose a project, branch and model to get started."}</Text>
            </View>
            <Button icon="Rocket" title="Start agent with ticket" primary disabled={!canLaunch} onPress={launch} />
          </View>
        </View>}
        </View>
      </> : <>
        <View style={{ ...styles.card, gap: 16 }}>
          <View style={{ ...styles.input, padding: 0, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon name="Search" size={18} color={colors.foregroundMuted} />
            <TextInput accessibilityLabel="Search tickets" value={query} onChangeText={setQuery} placeholder="Find your next ticket…" placeholderTextColor={colors.foregroundMuted} style={{ color: colors.foreground, paddingVertical: 14, fontSize: 14, flex: 1, minWidth: 0 }} />
          </View>
          <View style={styles.row}>
            <View style={{ width: 62, flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name="ListFilter" size={13} color={colors.foregroundMuted} /><Text style={styles.muted}>Status</Text></View>
            <Button title={`All · ${issues.length}`} chosen={status === null} onPress={() => setStatus(null)} />
            {statuses.map(([name, count]) => <Button key={name} title={`${name} · ${count}`} chosen={status === name} onPress={() => setStatus(status === name ? null : name)} />)}
          </View>
          <View style={styles.row}>
            <View style={{ width: 62, flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name="ArrowDownUp" size={13} color={colors.foregroundMuted} /><Text style={styles.muted}>Sort</Text></View>
            <Button icon="Clock" title="Updated" chosen={dateField === "updatedAt"} onPress={() => setDateField("updatedAt")} />
            <Button icon="Calendar" title="Created" chosen={dateField === "createdAt"} onPress={() => setDateField("createdAt")} />
            <Button icon={dateDirection === "newest" ? "ArrowDown" : "ArrowUp"} title={dateDirection === "newest" ? "Newest first" : "Oldest first"} onPress={() => setDateDirection(dateDirection === "newest" ? "oldest" : "newest")} />
            {!!(status || query) && <Button icon="X" title="Clear filters" onPress={() => { setStatus(null); setQuery(""); }} />}
          </View>
        </View>
        <View style={{ ...styles.row, justifyContent: "space-between" }}>
          <Text style={{ ...styles.muted, fontWeight: "600" }}>{visible.length} of {issues.length} tickets{cursor ? " loaded" : ""}{status ? ` · ${status}` : ""}</Text>
          <Text style={styles.muted}>{dateField === "updatedAt" ? "Last updated" : "Date created"} · {dateDirection === "newest" ? "newest first" : "oldest first"}</Text>
        </View>
        {!busy && !visible.length && <View style={{ ...styles.card, paddingVertical: 32, alignItems: "center" }}>
          <Icon name={issues.length ? "Search" : "CheckCircle"} size={30} color={colors.accent} />
          <Text style={styles.heading}>{issues.length ? "No matching tickets" : "You’re all caught up"}</Text>
          <Text style={styles.muted}>{issues.length ? "Try another status or search term." : "Your assigned tickets will appear here."}</Text>
          {!!(status || query) && <Button icon="X" title="Clear filters" onPress={() => { setStatus(null); setQuery(""); }} />}
        </View>}
        {!!visible.length && <View style={{ backgroundColor: colors.surface1, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
          {!layout.compact && <View style={{ ...styles.row, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.surface2, flexWrap: "nowrap" }}>
            <Text style={{ ...styles.muted, width: 90 }}>Issue</Text>
            <Text style={{ ...styles.muted, flex: 1 }}>Title / Project</Text>
            <Text style={{ ...styles.muted, width: 125 }}>Status</Text>
            <Text style={{ ...styles.muted, width: 110, textAlign: "right" }}>{dateField === "updatedAt" ? "Updated" : "Created"}</Text>
          </View>}
          {visible.map((issue, index) => <Pressable key={issue.id} accessibilityRole="button" accessibilityLabel={`View ${issue.identifier}: ${issue.title}, ${issueStatus(issue)}, ${dateField === "updatedAt" ? "updated" : "created"} ${formatIssueDate(issue[dateField])}`} disabled={Boolean(busy)} onPress={() => choose(issue)}
            style={({ pressed }) => ({ paddingHorizontal: 18, paddingVertical: layout.compact ? 14 : 16, borderTopWidth: index ? 1 : 0, borderTopColor: colors.surface2, backgroundColor: pressed ? colors.surface2 : colors.surface1, gap: 8 })}>
            <View style={{ ...styles.row, flexWrap: "nowrap", alignItems: "center" }}>
              {!layout.compact && <Text style={{ ...styles.muted, color: colors.accent, width: 90 }}>{issue.identifier}</Text>}
              <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                {layout.compact && <Text style={{ ...styles.muted, color: colors.accent }}>{issue.identifier}</Text>}
                <Text numberOfLines={layout.compact ? 2 : 1} style={{ ...styles.text, fontWeight: "600", fontSize: 15 }}>{issue.title}</Text>
                {!!(issue.project || issue.team || issue.labels.length || (issue.priority && issue.priority !== "No priority")) && <Text numberOfLines={1} style={styles.muted}>
                  {[issue.project, issue.team, ...issue.labels, issue.priority !== "No priority" ? issue.priority : ""].filter(Boolean).join(" · ")}
                </Text>}
              </View>
              {!layout.compact && <>
                <View style={{ width: 125 }}><StatusBadge status={issueStatus(issue)} theme={theme} /></View>
                <Text style={{ ...styles.muted, width: 110, textAlign: "right" }}>{formatIssueDate(issue[dateField])}</Text>
              </>}
            </View>
            {layout.compact && <View style={{ ...styles.row, justifyContent: "space-between" }}>
              <StatusBadge status={issueStatus(issue)} theme={theme} /><Text style={styles.muted}>{formatIssueDate(issue[dateField])}</Text>
            </View>}
          </Pressable>)}
        </View>}
        {cursor && <View style={{ ...styles.card, alignItems: "center" }}>
          <Text style={styles.muted}>Filters and sorting apply to loaded tickets. Load all to include every assignment.</Text>
          <View style={styles.row}>
            <Button icon="ChevronDown" title="Load more" onPress={() => void run("Loading tickets", async () => { await loadIssues(cursor); })} />
            <Button icon="Layers" title="Load all tickets" onPress={() => void run("Loading all tickets", loadAllIssues)} />
          </View>
        </View>}
      </>}
    </>}
  </ScrollView>;
}
