import type { PaseoProject } from "@getpaseo/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { branchesRpc, cachedOverviewRpc, connectRpc, countIssuesRpc, customersRpc, issueContextRpc, disconnectRpc, getDefaultPromptRpc, getSettingsRpc, listIssuesRpc, launchAgentRpc, searchIssuesRpc, setDefaultPromptRpc, setSettingsRpc, statusRpc, workspaceLabelsRpc, DEFAULT_LIST_FILTER, type Issue, type ListFilter, type ListView, type RelatedTicket, type TicketDetail } from "../shared/contracts";
import { filterIssues, formatIssueDate, formatPriority, formatRelativeDate, hasPriority, issueStatus, statusChangesText, statusCounts, type DependencyFilter, type SortDirection, type SortField } from "./issue-list";

import { ChoicePicker } from "./choice-picker";
import { Icon, copyText } from "@getpaseo/plugin/client/react-native";
import { BrandMark, Button, Callout, Disclosure, Divider, EmptyState, FieldLabel, LabelChip, MetaItem, PriorityMark, ProviderMark, SectionHeading, Segmented, Skeleton, StatusBadge, StatusMark, SurfaceProvider } from "./ui";
import { tokensFor } from "./design";
import { openExternalUrl } from "./open-link";
import { MarkdownPreview } from "./markdown-preview";
import { restoreLaunchSelection, type LaunchPreference } from "./launch-preferences";
import { labelMappingConflict, mappedBaseBranch, mappingKey, mappingLabel, resolveMapping, type MappingSource, type ProjectMapping } from "../shared/mapping";
import { activeFilterCount, issueLabelChips, labelRefDisplay, labelRefKey, quickLabels, toggleLabel, type WorkspaceLabel } from "./label-tools";
import { TicketBoard } from "./board";
import { ListFilters, type CustomerChoice } from "./list-filters";
import { CustomerRequests } from "./customer-requests";
import { MappingView } from "./mapping-view";

type ThinkingOption = { id: string; label: string; description?: string; isDefault?: boolean };
type ModelChoice = { id: string; label: string; provider: string; description?: string; thinkingOptions: ThinkingOption[]; defaultThinkingOptionId?: string };
type ModeChoice = { id: string; label: string; description?: string; icon?: string };
type LinkedAgent = { id: string; title: string | null; status: string; updatedAt: string };

const CACHE_MAX_AGE_MS = 5 * 60_000;

function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
// Used only for request deduplication, never as a security token.
function requestId() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = Math.floor(Math.random() * 16); return (c === "x" ? r : (r & 3) | 8).toString(16);
}); }

export function LinearTicketsSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const compact = layout.compact || (surfaceWidth > 0 && surfaceWidth < 760);
  const splitDetail = !compact && surfaceWidth >= 1000;
  const getBranches = useRpc(branchesRpc);
  const getStatus = useRpc(statusRpc), connect = useRpc(connectRpc), disconnect = useRpc(disconnectRpc);
  const getIssues = useRpc(listIssuesRpc), getIssuesCount = useRpc(countIssuesRpc), getCachedOverview = useRpc(cachedOverviewRpc), getDetail = useRpc(issueContextRpc), start = useRpc(launchAgentRpc);
  const searchAll = useRpc(searchIssuesRpc);
  const getTemplate = useRpc(getDefaultPromptRpc), saveTemplate = useRpc(setDefaultPromptRpc);
  const getSettings = useRpc(getSettingsRpc), saveSettings = useRpc(setSettingsRpc);
  const getLabels = useRpc(workspaceLabelsRpc), getCustomers = useRpc(customersRpc);
  const [filter, setFilter] = useState<ListFilter>(DEFAULT_LIST_FILTER);
  const filterRef = useRef<ListFilter>(DEFAULT_LIST_FILTER);
  const [workspaceLabels, setWorkspaceLabels] = useState<WorkspaceLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsVersion, setLabelsVersion] = useState(0);
  const [customers, setCustomers] = useState<CustomerChoice[]>([]);
  const [customersAvailable, setCustomersAvailable] = useState(false);
  // The list view (sort and filters) is saved once the saved one has been restored.
  const listViewRestored = useRef(false);
  const [markInProgress, setMarkInProgress] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateText, setTemplateText] = useState("");
  const [templateSaved, setTemplateSaved] = useState<string | null>(null);
  const [builtinTemplate, setBuiltinTemplate] = useState("");
  const [connection, setConnection] = useState<{ connected: boolean; source: "none" | "saved" | "environment" } | null>(null);
  const [key, setKey] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ total: number; byName: Record<string, number>; byType: Record<string, number>; complete: boolean } | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Issue[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [dependency, setDependency] = useState<DependencyFilter>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [dateField, setDateField] = useState<SortField>("updatedAt");
  const [dateDirection, setDateDirection] = useState<SortDirection>("newest");
  const [layoutMode, setLayoutMode] = useState<"list" | "board">("list");
  const [view, setView] = useState<"list" | "settings" | "mappings">("list");
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
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [branchesFor, setBranchesFor] = useState<string | null>(null);
  // A ticket's branch request, applied once branches are loaded for the selected project.
  const [wantedBranch, setWantedBranch] = useState<{ branch?: string } | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branchesVersion, setBranchesVersion] = useState(0);
  const [providerGroup, setProviderGroup] = useState("");
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [modes, setModes] = useState<Record<string, ModeChoice[]>>({});
  const [provider, setProvider] = useState("");
  const [modeId, setModeId] = useState("");
  const [thinkingOptionId, setThinkingOptionId] = useState("");
  const [launchPreferences, setLaunchPreferences] = useState<Record<string, LaunchPreference>>({});
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [projectMappings, setProjectMappings] = useState<Record<string, ProjectMapping>>({});
  const [agentLinearAccess, setAgentLinearAccess] = useState(true);
  const [mappingReason, setMappingReason] = useState<"label" | "saved" | "name" | "recent" | null>(null);
  const [lastProject, setLastProject] = useState<{ projectId: string; baseBranch?: string } | null>(null);
  const [mappingLabels, setMappingLabels] = useState<string[]>([]);
  // The ticket whose mapping was applied or overridden by hand; the branch waits for the list.
  const mappedFor = useRef<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [showRelatedTickets, setShowRelatedTickets] = useState(false);
  const [contextCopied, setContextCopied] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<{ agentId: string; warnings: string[] } | null>(null);
  const [linkedAgents, setLinkedAgents] = useState<LinkedAgent[]>([]);
  const [linkedAgentsLoading, setLinkedAgentsLoading] = useState(false);
  const launchRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const restoredLaunchPreference = useRef(false);
  const statusRef = useRef<string | null>(null);
  const dependencyRef = useRef<DependencyFilter>("all");

  const run = async (label: string, task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null);
    try { await task(); } catch (error) { setError(message(error)); }
    finally { busyRef.current = false; setBusy(null); }
  };

  const loadIssues = useCallback(async (next?: string, selection?: { status: string | null; dependency?: DependencyFilter; filter?: ListFilter }) => {
    const f = selection ?? { status: statusRef.current, dependency: dependencyRef.current };
    const page = await getIssues({
      ...(next ? { cursor: next } : {}),
      ...(f.status ? { stateNames: [f.status] } : {}),
      ...(f.dependency && f.dependency !== "all" ? { relation: f.dependency } : {}),
      filter: f.filter ?? filterRef.current,
    });
    if (next && page.nextCursor === next) throw new Error("Linear repeated a page. Refresh the ticket list to continue.");
    setIssues((previous) => [...new Map((next ? [...previous, ...page.issues] : page.issues).map((issue) => [issue.id, issue])).values()]);
    setCursor(page.nextCursor);
    if (!next && !f.status) setLastUpdatedAt(new Date().toISOString());
    return page.nextCursor;
  }, [getIssues]);

  const refreshCounts = useCallback(async () => {
    try { setCounts(await getIssuesCount({ filter: filterRef.current })); } catch { setCounts(null); /* counts are non-critical; the list still loads without them */ }
  }, [getIssuesCount]);

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

  // Settings come first: the saved sort and filters decide which tickets are requested.
  const applySettings = useCallback((value: Awaited<ReturnType<typeof getSettings>>) => {
    setMarkInProgress(value.markInProgress); setShowClosed(value.showClosed);
    setLaunchPreferences(value.launchPreferences); setLastProvider(value.lastProvider);
    setProjectMappings(value.projectMappings); setAgentLinearAccess(value.agentLinearAccess);
    setLastProject(value.lastProject);
    const saved = value.listView;
    if (saved) {
      setLayoutMode(saved.layout); setDateField(saved.sortField); setDateDirection(saved.sortDirection);
      statusRef.current = saved.status; setStatus(saved.status);
      dependencyRef.current = saved.dependency; setDependency(saved.dependency);
      filterRef.current = saved.filter; setFilter(saved.filter);
    }
  }, []);

  useEffect(() => {
    void run("Loading connection", async () => {
      const settings = await getSettings({}).catch(() => null);
      if (settings) applySettings(settings);
      listViewRestored.current = true;
      setSettingsLoaded(true);
      const status = await getStatus({}); setConnection(status);
      if (status.connected) {
        const filtered = Boolean(statusRef.current || dependencyRef.current !== "all");
        const cached = filtered ? null : await getCachedOverview({ filter: filterRef.current }).catch(() => null);
        if (cached) {
          setIssues(cached.issues); setCursor(cached.nextCursor); setCounts(cached.counts ?? null); setLastUpdatedAt(cached.updatedAt);
        }
        const cachedTime = cached ? Date.parse(cached.updatedAt) : Number.NaN;
        if (!Number.isFinite(cachedTime) || Date.now() - cachedTime >= CACHE_MAX_AGE_MS) {
          await loadIssues(); void refreshCounts();
        } else if (!cached?.counts) void refreshCounts();
      }
    });
    void loadOptions();
  }, [getStatus, getSettings, applySettings, getCachedOverview, loadIssues, loadOptions, refreshCounts]);

  // Remember the sort and filters on this host whenever they change.
  const listView: ListView = useMemo(() => ({ layout: layoutMode, sortField: dateField, sortDirection: dateDirection, status, dependency, filter }), [layoutMode, dateField, dateDirection, status, dependency, filter]);
  const savedListView = useRef<string | null>(null);
  useEffect(() => {
    if (!listViewRestored.current) return;
    const serialized = JSON.stringify(listView);
    if (savedListView.current === null) { savedListView.current = serialized; return; }
    if (savedListView.current === serialized) return;
    savedListView.current = serialized;
    const handle = setTimeout(() => { void saveSettings({ listView }).catch(() => {}); }, 400);
    return () => clearTimeout(handle);
  }, [listView, saveSettings]);

  // Workspace labels and customers feed the filters and the label mappings.
  useEffect(() => {
    if (!connection?.connected) return;
    let cancelled = false;
    setLabelsLoading(true); setLabelsError(null);
    void getLabels({ refresh: labelsVersion > 0 }).then((value) => { if (!cancelled) setWorkspaceLabels(value.labels); },
      (error) => { if (!cancelled) setLabelsError(message(error)); }).finally(() => { if (!cancelled) setLabelsLoading(false); });
    void getCustomers({}).then((value) => { if (!cancelled) { setCustomers(value.customers); setCustomersAvailable(value.available); } }, () => {});
    return () => { cancelled = true; };
  }, [connection?.connected, getLabels, getCustomers, labelsVersion]);

  useEffect(() => {
    void getTemplate({}).then((result) => {
      setBuiltinTemplate(result.builtin);
      setTemplateSaved(result.template);
      setTemplateText(result.template ?? result.builtin);
    }, () => { setTemplateOpen(false); });
  }, [getTemplate]);

  // A reload of the same ticket (Retry) keeps the current detail on screen.
  const detailFor = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDetailError(null);
    if (detailFor.current !== (selected?.id ?? null)) {
      detailFor.current = selected?.id ?? null;
      setDetail(null); setShowContext(false); setShowRelatedTickets(false); setContextCopied(false);
    }
    if (!selected) { setDetailLoading(false); return; }
    setDetailLoading(true);
    void getDetail({ id: selected.id }).then((value) => {
      if (cancelled) return;
      setDetail(value);
      // Fresher fields (labels, status) show up in the list without a full refresh.
      setIssues((previous) => previous.map((issue) => issue.id === value.issue.id ? { ...issue, ...value.issue } : issue));
    }, (error) => { if (!cancelled) setDetailError(message(error)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected, getDetail, detailVersion]);

  useEffect(() => {
    let cancelled = false;
    setLinkedAgents([]);
    if (!selected) { setLinkedAgentsLoading(false); return; }
    setLinkedAgentsLoading(true);
    void paseo.agents.list({
      filter: { labels: { "linear.issueId": selected.id }, includeArchived: false },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 20 },
    }).then((result) => {
      if (!cancelled) setLinkedAgents(result.entries.map(({ agent }) => ({ id: agent.id, title: agent.title, status: agent.status, updatedAt: agent.updatedAt })));
    }, () => { if (!cancelled) setLinkedAgents([]); })
      .finally(() => { if (!cancelled) setLinkedAgentsLoading(false); });
    return () => { cancelled = true; };
  }, [paseo, selected]);

  useEffect(() => {
    if (!selected) return;
    return paseo.agents.subscribe((update) => {
      if (update.kind === "remove") {
        setLinkedAgents((previous) => previous.filter((item) => item.id !== update.agentId));
        return;
      }
      const linkedIssueId = update.agent.labels?.["linear.issueId"];
      if (update.agent.archivedAt || linkedIssueId !== selected.id) {
        setLinkedAgents((previous) => previous.filter((item) => item.id !== update.agent.id));
        return;
      }
      const linked = { id: update.agent.id, title: update.agent.title, status: update.agent.status, updatedAt: update.agent.updatedAt };
      setLinkedAgents((previous) => [linked, ...previous.filter((item) => item.id !== linked.id)]);
    });
  }, [paseo, selected]);

  // Workspace-wide search: a short pause after typing, then Linear's own search over every
  // team the key can see. Results render in their own section, de-duplicated against the
  // loaded assignments; the local list keeps its fast client-side filtering.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || !connection?.connected) { setSearchResults([]); setSearchError(null); return; }
    setSearching(true); setSearchError(null);
    let cancelled = false;
    const handle = setTimeout(() => {
      void searchAll({ term })
        .then((page) => { if (!cancelled) setSearchResults(page.issues); })
        .catch((error) => { if (!cancelled) setSearchError(message(error)); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); setSearching(false); };
  }, [query, connection?.connected, searchAll, searchVersion]);

  const project = projects.find((item) => item.projectId === projectId);
  useEffect(() => {
    let cancelled = false;
    setBranches([]); setDefaultBranch(null); setBranchesFor(null); setBaseBranch(""); setBranchesError(null);
    if (!project || project.projectKind !== "git") { setBranchesLoading(false); setBranchesFor(projectId); return; }
    setBranchesLoading(true);
    void getBranches({ projectId: project.projectId }).then((result) => {
      if (cancelled) return;
      setBranches(result.branches); setDefaultBranch(result.defaultBranch); setBranchesFor(project.projectId);
      setBaseBranch(result.defaultBranch ?? "");
    }, (error) => { if (!cancelled) setBranchesError(message(error)); })
      .finally(() => { if (!cancelled) setBranchesLoading(false); });
    return () => { cancelled = true; };
  }, [project?.projectId, project?.projectKind, project?.projectRootPath, getBranches, branchesVersion]);
  useEffect(() => {
    if (!wantedBranch || branchesLoading || branchesFor !== projectId) return;
    setWantedBranch(null);
    setBaseBranch(mappedBaseBranch(wantedBranch.branch, branches, defaultBranch));
  }, [wantedBranch, branchesLoading, branchesFor, projectId, branches, defaultBranch]);
  const mappingSource: MappingSource | null = detail ? { projectId: detail.projectId, projectName: detail.issue.project, teamId: detail.teamId, teamName: detail.issue.team, labels: detail.issue.labelInfo ?? [] } : null;
  useEffect(() => {
    if (!detail || !mappingSource || detail.issue.id !== selected?.id || !settingsLoaded || optionsLoading || mappedFor.current === selected.id) return;
    mappedFor.current = selected.id;
    const resolved = resolveMapping(mappingSource, projectMappings, projects, lastProject);
    setMappingReason(resolved?.reason ?? null);
    setMappingLabels(resolved?.reason === "label" ? resolved.labels ?? [] : labelMappingConflict(mappingSource, projectMappings, projects).flatMap((target) => target.labels));
    setWantedBranch(resolved?.baseBranch ? { branch: resolved.baseBranch } : {});
    if (!resolved || resolved.projectId === projectId) return;
    setProjectId(resolved.projectId); setBaseBranch(""); setBranches([]);
    // mappingSource is derived from detail; the effect runs once per opened ticket.
  }, [detail, selected, settingsLoaded, optionsLoading, projects, projectMappings, lastProject]);
  const providerGroups = [...new Set(models.map((model) => model.provider))];
  const selectedModel = models.find((model) => model.id === provider);
  const activeModes = modes[providerGroup] ?? [];
  const thinkingOptions = selectedModel?.thinkingOptions ?? [];
  const selectProvider = useCallback((group: string) => {
    const restored = restoreLaunchSelection(group, launchPreferences[group], models, modes);
    setProviderGroup(group); setProvider(restored.model); setModeId(restored.modeId); setThinkingOptionId(restored.thinkingOptionId);
  }, [launchPreferences, models, modes]);
  useEffect(() => {
    if (restoredLaunchPreference.current || !settingsLoaded || optionsLoading || !models.length) return;
    restoredLaunchPreference.current = true;
    if (lastProvider && models.some((model) => model.provider === lastProvider)) selectProvider(lastProvider);
  }, [lastProvider, models, optionsLoading, selectProvider, settingsLoaded]);
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

  const t = useMemo(() => tokensFor(theme, { ...layout, compact }), [theme, layout, compact]);
  const colors = t.colors;

  const visible = filterIssues(issues, query, status, dateField, dateDirection, dependency);
  const searchTerm = query.trim();
  const loadedIds = useMemo(() => new Set(issues.map((issue) => issue.id)), [issues]);
  const remoteVisible = searchResults.filter((issue) => !loadedIds.has(issue.id));
  // Chips: server-side counts across all assignments once the count pass lands; until then
  // (or if it failed) fall back to the distinct names in the loaded pages.
  const statuses: [string, number][] = counts
    ? [...Object.entries(counts.byName)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8)
    : statusCounts(issues);
  // A chip is grouped by state name; use the first loaded ticket's workflow category for its accent.
  const statusTypeFor = (name: string) => issues.find((issue) => issueStatus(issue) === name)?.statusType ?? "";
  // Keep a selected filter visible even when its last ticket leaves the loaded pages.
  if (status && !statuses.some(([name]) => name === status)) statuses.push([status, counts?.byName[status] ?? 0]);
  const ticketsLoading = busy === "Loading connection" || busy === "Refreshing tickets" || busy === "Loading tickets" || busy === "Loading all tickets";
  const current = detail?.issue ?? selected;
  const relatedTickets = detail ? [
    ...(detail.relations.parent ? [{ ...detail.relations.parent, relationLabel: "Parent" }] : []),
    ...detail.relations.subissues.map((ticket) => ({ ...ticket, relationLabel: "Subissue" })),
    ...detail.relations.related.map((ticket) => ({ ...ticket, relationLabel: ticket.direction })),
  ] : [];
  const missingRequirement = !project ? "Choose a project"
    : project.projectKind === "git" && !baseBranch ? "Choose a base branch"
      : !provider ? "Choose a model"
        : optionsLoading || branchesLoading ? "Loading choices…"
          : !detail ? "Loading ticket details…" : "";
  const changeStatus = (name: string | null) => {
    statusRef.current = name; setStatus(name); setIssues([]); setCursor(null);
    void run("Loading tickets", async () => { await loadIssues(undefined, { status: name, dependency: dependencyRef.current }); });
  };
  // Filters are server-side: the list, counts and cache all follow them.
  const changeFilter = (next: ListFilter) => {
    filterRef.current = next; setFilter(next); setIssues([]); setCursor(null); setCounts(null);
    void run("Loading tickets", async () => { await loadIssues(); void refreshCounts(); });
  };
  const clearFilters = () => {
    dependencyRef.current = "all"; setDependency("all"); statusRef.current = null; setStatus(null); setQuery("");
    changeFilter(DEFAULT_LIST_FILTER);
  };
  const changeDependency = (value: DependencyFilter) => {
    dependencyRef.current = value; setDependency(value); setIssues([]); setCursor(null);
    void run("Loading tickets", async () => { await loadIssues(undefined, { status: statusRef.current, dependency: value }); });
  };
  const choose = (issue: Issue) => {
    setSelected(issue); setAgent(null); setError(null); setInstructions(""); launchRequest.current = null;
    mappedFor.current = null; setWantedBranch(null); setMappingReason(null);
  };
  const chooseRelated = (ticket: RelatedTicket) => choose({
    id: ticket.id, identifier: ticket.identifier, title: ticket.title, url: ticket.url,
    status: ticket.status, statusType: ticket.statusType, branchName: "", priority: "",
    dueDate: null, estimate: null, project: "", description: "", team: "", labels: [],
    updatedAt: "", createdAt: "", blockingCount: 0, blockedByCount: 0,
  });
  const launch = () => void run("Starting agent", async () => {
    if (!selected || !canLaunch) return;
    const fingerprint = JSON.stringify([selected.id, projectId, baseBranch, provider, modeId, thinkingOptionId, instructions, markInProgress]);
    if (launchRequest.current?.fingerprint !== fingerprint) launchRequest.current = { fingerprint, id: requestId() };
    const result = await start({ id: selected.id, projectId, baseBranch: project?.projectKind === "git" ? baseBranch : undefined, provider, modeId: modeId || undefined, thinkingOptionId: thinkingOptionId || undefined, instructions, markInProgress, requestId: launchRequest.current.id });
    setAgent(result);
    const launchPreference = { model: provider, ...(modeId ? { modeId } : {}), ...(thinkingOptionId ? { thinkingOptionId } : {}) };
    setLaunchPreferences((previous) => ({ ...previous, [providerGroup]: launchPreference }));
    setLastProvider(providerGroup);
    // One patch per launch: the model choice and the project mapping are saved together.
    // A label mapping already decides this ticket; remembering its project too would only add noise.
    const key = mappingSource && mappingReason !== "label" ? mappingKey(mappingSource) : null;
    const projectMapping = key && mappingSource ? { key, projectId, label: mappingLabel(mappingSource), ...(project?.projectKind === "git" && baseBranch ? { baseBranch } : {}) } : undefined;
    const recent = { projectId, ...(project?.projectKind === "git" && baseBranch ? { baseBranch } : {}) };
    setLastProject(recent);
    void saveSettings({ launchPreference: { provider: providerGroup, ...launchPreference }, lastProject: recent, ...(projectMapping ? { projectMapping } : {}) })
      .then((saved) => setProjectMappings(saved.projectMappings), () => {
        setOptionsError("Agent started, but its model and project choices could not be remembered.");
      });
    setLinkedAgents((previous) => previous.some((item) => item.id === result.agentId) ? previous : [{ id: result.agentId, title: `${selected.identifier}: ${selected.title}`, status: "initializing", updatedAt: new Date().toISOString() }, ...previous]);
  });
  const copyContext = () => {
    if (!detail) return;
    void copyText(detail.context).then(() => { setContextCopied(true); setTimeout(() => setContextCopied(false), 1600); }, () => setContextCopied(false));
  };

  const connectionPill = connection?.connected ? <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 }}>
    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.statusSuccess }} />
    <Text style={{ ...t.muted, fontSize: 12, fontWeight: "600" }}>{connection.source === "environment" ? "Host key" : "Connected"}</Text>
  </View> : null;

  const metaLine = (issue: Issue) => {
    const allChips = issueLabelChips(issue);
    const chips = allChips.slice(0, compact ? 2 : 3);
    const extra = allChips.length - chips.length;
    const customerNames = (issue.customers ?? []).map((customer) => customer.name);
    const places = [issue.project, issue.team].filter(Boolean).join(" · ");
    const due = issue.dueDate ? `Due ${formatIssueDate(issue.dueDate)}` : "";
    const estimate = issue.estimate ? `${issue.estimate} pts` : "";
    const dependencies = [issue.blockingCount ? `Blocks ${issue.blockingCount}` : "", issue.blockedByCount ? `Blocked by ${issue.blockedByCount}` : ""].filter(Boolean);
    if (!places && !chips.length && !extra && !due && !estimate && !dependencies.length && !customerNames.length) return null;
    return <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
      {!!places && <Text numberOfLines={1} style={t.muted}>{places}</Text>}
      {chips.map((chip) => <LabelChip key={chip.label} label={chip.label} color={chip.color} t={t} />)}
      {extra > 0 && <Text style={t.muted}>+{extra}</Text>}
      {!!customerNames.length && <LabelChip label={customerNames.length > 2 ? `${customerNames.slice(0, 2).join(", ")} +${customerNames.length - 2}` : customerNames.join(", ")} icon="Building2" t={t} />}
      {due && <Text style={{ ...t.muted, color: colors.accent, fontSize: 11 }}>{due}</Text>}
      {estimate && <Text style={{ ...t.muted, fontSize: 11 }}>{estimate}</Text>}
      {dependencies.map((item) => <View key={item} style={{ backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}><Text style={{ color: colors.accent, fontSize: 11, fontWeight: "700" }}>{item}</Text></View>)}
    </View>;
  };

  const renderIssueRow = (issue: Issue, index: number) => {
    const isHovered = hovered === issue.id;
    const rightText = dateField === "priority" ? (hasPriority(issue.priority) ? formatPriority(issue.priority) : "—") : formatRelativeDate(issue[dateField] ?? "");
    const dependencyText = [issue.blockingCount ? `blocks ${issue.blockingCount}` : "", issue.blockedByCount ? `blocked by ${issue.blockedByCount}` : ""].filter(Boolean).join(", ");
    return <Pressable key={issue.id} accessibilityRole="button" accessibilityLabel={`View ${issue.identifier}: ${issue.title}, ${issueStatus(issue)}, ${rightText}${dependencyText ? `, ${dependencyText}` : ""}`} disabled={Boolean(busy)} onPress={() => choose(issue)}
      onHoverIn={() => setHovered(issue.id)} onHoverOut={() => setHovered(null)}
      style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: compact ? 14 : 15, borderTopWidth: index ? 1 : 0, borderTopColor: colors.surface2, backgroundColor: pressed || isHovered ? colors.surface2 : colors.surface1, gap: 8 })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: compact ? "wrap" : "nowrap" }}>
        {!compact && <View style={{ width: 20, alignItems: "center" }}><PriorityMark priority={issue.priority} t={t} /></View>}
        {!compact && <Text style={{ color: colors.accent, width: 82, fontFamily: "monospace", fontSize: 12 }}>{issue.identifier}</Text>}
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          {compact && <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <PriorityMark priority={issue.priority} t={t} />
            <Text style={{ color: colors.accent, fontFamily: "monospace", fontSize: 12 }}>{issue.identifier}</Text>
          </View>}
          <Text numberOfLines={compact ? 2 : 1} style={{ ...t.strong, fontSize: 15, lineHeight: 21 }}>{issue.title}</Text>
          {metaLine(issue)}
        </View>
        {!compact && <>
          <View style={{ width: 130 }}><StatusBadge status={issueStatus(issue)} statusType={issue.statusType} t={t} /></View>
          <Text style={{ ...t.muted, width: 88, textAlign: "right" }}>{rightText}</Text>
          <Icon name="ChevronRight" size={15} color={isHovered ? colors.accent : colors.foregroundMuted} />
        </>}
        {compact && <Icon name="ChevronRight" size={15} color={isHovered ? colors.accent : colors.foregroundMuted} />}
      </View>
      {compact && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <StatusBadge status={issueStatus(issue)} statusType={issue.statusType} t={t} /><Text style={t.muted}>{rightText}</Text>
      </View>}
    </Pressable>;
  };

  const settingsCard = <View style={{ ...t.card, gap: 14 }}>
    <SectionHeading title="Settings" subtitle="Saved on this host and applied to the ticket list and new launches." icon="Settings" t={t} />
    <FieldLabel title="Ticket status" icon="ListTodo" hint="when the agent starts" t={t} />
    <Button title={markInProgress ? "Mark the ticket In Progress when the agent starts" : "Keep the ticket in its current state"} icon={markInProgress ? "Check" : "CircleDashed"} stretch chosen={markInProgress}
      onPress={() => void run("Saving setting", async () => {
        const next = !markInProgress;
        setMarkInProgress(next);
        setMarkInProgress((await saveSettings({ markInProgress: next })).markInProgress);
      })} />
    <Text style={t.muted}>This controls the launch-time status change. Agent access is configured separately below. The ticket only moves when its team has an In Progress state and it is not already in one.</Text>
    <Divider t={t} spaced />
    <FieldLabel title="Tickets shown" icon="Eye" hint="in the list and the status counts" t={t} />
    <Button title={showClosed ? "Show completed, canceled and duplicated tickets" : "Hide completed, canceled and duplicated tickets"} icon={showClosed ? "Check" : "CircleDashed"} stretch chosen={showClosed}
      onPress={() => void run("Updating ticket list", async () => {
        const next = !showClosed;
        setShowClosed(next);
        setShowClosed((await saveSettings({ showClosed: next })).showClosed);
        statusRef.current = null; setStatus(null); setIssues([]); setCursor(null);
        await loadIssues(undefined, { status: null });
        void refreshCounts();
      })} />
    <Text style={t.muted}>Off keeps the list focused on open work; finished, canceled and duplicated tickets stay hidden from the list and the counts.</Text>
    <Divider t={t} spaced />
    <FieldLabel title="Agent access to Linear" icon="KeyRound" hint="for agents started from a ticket" t={t} />
    <Button title={agentLinearAccess ? "Agents can comment on, move and link their own ticket" : "Agents cannot change Linear"} icon={agentLinearAccess ? "Check" : "CircleDashed"} stretch chosen={agentLinearAccess}
      onPress={() => void run("Saving setting", async () => {
        const next = !agentLinearAccess;
        setAgentLinearAccess(next);
        setAgentLinearAccess((await saveSettings({ agentLinearAccess: next })).agentLinearAccess);
      })} />
    <Text style={t.muted}>On gives each new agent linear_ticket tools that act only on the ticket it started from, using this host's Linear key; canceling or marking duplicate stays with people. It needs a key with write access. Existing agents keep what they started with.</Text>
    <Divider t={t} spaced />
    <FieldLabel title="Repository mappings" icon="FolderGit2" hint="label, Linear project or team → Paseo project" t={t} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <Button title="Manage repository mappings" icon="FolderGit2" size="sm" onPress={() => setView("mappings")} />
      <Text style={{ ...t.muted, flex: 1, minWidth: 180 }}>{(() => {
        const labelCount = Object.keys(projectMappings).filter((key) => key.startsWith("label:")).length;
        const otherCount = Object.keys(projectMappings).length - labelCount;
        return labelCount || otherCount ? `${labelCount} label mapping${labelCount === 1 ? "" : "s"}, ${otherCount} remembered project or team mapping${otherCount === 1 ? "" : "s"}.` : "None yet. Map labels to repositories, or start an agent to remember a Linear project.";
      })()}</Text>
    </View>
    <Divider t={t} spaced />
    <FieldLabel title="Default prompt" icon="PenLine" hint="the system prompt used when you start an agent" t={t} />
    {templateOpen ? <View style={{ gap: 8 }}>
      <TextInput accessibilityLabel="Default prompt template" editable={!busy} multiline maxLength={8000} value={templateText} onChangeText={setTemplateText}
        placeholder="How the agent should work on this ticket…" placeholderTextColor={colors.foregroundMuted} style={{ ...t.mono, minHeight: 120, textAlignVertical: "top" }} />
      <Text style={t.muted}>Placeholders: {"{{ticket}}"} = ticket ID and title · {"{{instructions}}"} = the extra direction you type at launch · {"{{context}}"} = the ticket snapshot (required) · {"{{linear_access}}"} = what the agent may change in Linear (appended when missing).</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button title="Save default prompt" icon="Check" onPress={() => void run("Saving default prompt", async () => {
          const result = await saveTemplate({ template: templateText });
          setTemplateSaved(result.template); setTemplateText(result.template ?? result.builtin); setTemplateOpen(false);
        })} />
        <Button title="Reset to built-in" icon="RotateCcw" onPress={() => void run("Resetting default prompt", async () => {
          const result = await saveTemplate({ template: "" });
          setTemplateSaved(null); setTemplateText(result.builtin); setTemplateOpen(false);
        })} />
      </View>
    </View> : <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <Button title="Edit default prompt" icon="PenLine" size="sm" disabled={Boolean(busy)} onPress={() => { setTemplateText(templateSaved ?? builtinTemplate); setTemplateOpen(true); }} />
      <Text style={t.muted}>{templateSaved ? "A custom template is used for new agents." : "The built-in default is used for new agents."}</Text>
    </View>}
    <Button title="Back to tickets" icon="ArrowLeft" size="sm" onPress={() => setView("list")} />
  </View>;

  return <SurfaceProvider t={t} busy={Boolean(busy)}><ScrollView keyboardShouldPersistTaps="handled" onLayout={(event) => setSurfaceWidth(event.nativeEvent.layout.width)} style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: compact ? 16 : 28, gap: compact ? 18 : 22, width: "100%", maxWidth: 1280, alignSelf: "center" }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 15, flex: 1, minWidth: 230 }}>
        <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
          <BrandMark brand="linear" label="Linear" theme={theme} size={26} radius={17} />
        </View>
        <View style={{ gap: 3, flex: 1 }}>
          <Text style={{ ...t.eyebrow, textTransform: "uppercase" }}>Linear · My work</Text>
          <Text style={t.title}>Linear tickets</Text>
          <Text style={t.muted}>{selected ? "Review the ticket and configure your agent." : "Choose a ticket, review its context, and start an agent."}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {connectionPill}
        {connection?.connected && <>
          <Button title="Connection" icon="Plug" iconOnly size="md" chosen={manageConnection} onPress={() => setManageConnection(!manageConnection)} />
          <Button title="Settings" icon="Settings" iconOnly size="md" chosen={view === "settings"} onPress={() => setView(view === "settings" ? "list" : "settings")} />
          <Button title="Refresh tickets" icon="RefreshCw" iconOnly onPress={() => void run("Refreshing tickets", async () => { await loadIssues(); void refreshCounts(); })} />
        </>}
      </View>
    </View>
    {busy && !ticketsLoading && <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><ActivityIndicator color={colors.accent} /><Text style={t.muted}>{busy}…</Text></View>}
    {error && <Callout message={error} tone="danger" t={t} />}

    {!connection?.connected ? <View style={{ ...t.card, gap: 14 }}>
      <SectionHeading title="Connect your work" subtitle="Bring your assigned Linear tickets into Paseo." icon="Plug" t={t} />
      <View style={{ gap: 10 }}>
        {[
          "Create a personal API key in Linear → Settings → Security & access.",
          "Paste it below, or set LINEAR_API_KEY in the daemon environment.",
          "A read-only key covers browsing. Write permission is needed for status changes and agent access to Linear.",
        ].map((step, index) => <View key={step} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "700" }}>{index + 1}</Text>
          </View>
          <Text style={{ ...t.body, flex: 1 }}>{step}</Text>
        </View>)}
      </View>
      <Callout t={t} tone="info" message="The key is stored privately on this Paseo host and is shared by clients connected to it. It is never added to ticket context or agent prompts." />
      <FieldLabel title="Linear API key" icon="KeyRound" t={t} />
      <TextInput accessibilityLabel="Linear API key" secureTextEntry autoCapitalize="none" autoCorrect={false} value={key} onChangeText={setKey} placeholder="lin_api_…" placeholderTextColor={colors.foregroundMuted} style={t.input} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button title="Connect Linear" icon="Plug" primary disabled={!key.trim()} onPress={() => void run("Connecting Linear", async () => {
          setConnection(await connect({ apiKey: key.trim() })); setKey(""); await loadIssues(); void refreshCounts();
        })} />
        <Button title="Retry saved connection" icon="RefreshCw" onPress={() => void run("Loading connection", async () => {
          const status = await getStatus({}); setConnection(status);
          if (status.connected) { await loadIssues(); void refreshCounts(); }
        })} />
      </View>
    </View> : <>
      {manageConnection && <View style={{ ...t.card, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ gap: 3, flex: 1, minWidth: 220 }}>
          <Text style={t.strong}>Linear connection</Text>
          <Text style={t.muted}>{connection.source === "environment" ? "Key supplied by the daemon environment (LINEAR_API_KEY)." : "Key saved on this Paseo host."}</Text>
        </View>
        {connection.source !== "environment" && <Button title="Disconnect" icon="Unplug" tone="danger" onPress={() => void run("Disconnecting", async () => {
          setConnection(await disconnect({})); setIssues([]); setCounts(null); setLastUpdatedAt(null); setSearchResults([]); setSearchError(null); setSelected(null); setAgent(null); setCursor(null); statusRef.current = null; setStatus(null); setQuery(""); setWorkspaceLabels([]); setCustomers([]); setCustomersAvailable(false);
        })} />}
      </View>}

      {view === "mappings" ? <MappingView t={t} projects={projects} labels={workspaceLabels} labelsLoading={labelsLoading} labelsError={labelsError} onRetryLabels={() => setLabelsVersion((value) => value + 1)}
        mappings={projectMappings} disabled={Boolean(busy)} onBack={() => setView("settings")}
        onSave={async (key, mapping) => { setProjectMappings((await saveSettings({ projectMapping: { key, ...mapping } })).projectMappings); }}
        onForget={async (key) => { setProjectMappings((await saveSettings({ forgetProjectMapping: key })).projectMappings); }} />
      : view === "settings" ? settingsCard : selected && current ? <>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button title="Tickets" icon="ArrowLeft" onPress={() => { setSelected(null); setAgent(null); setError(null); }} />
          {/^https:\/\/linear\.app\//.test(selected.url) && <Button title="Open in Linear" icon="ExternalLink" onPress={() => void run("Opening Linear", async () => { await openExternalUrl(selected.url, { platform: layout.platform, linking: Linking }); })} />}
        </View>
        <View style={{ flexDirection: splitDetail ? "row" : "column", alignItems: "flex-start", gap: 20 }}>
          <View style={{ ...t.card, gap: 14, flex: splitDetail ? 1.15 : undefined, width: splitDetail ? undefined : "100%", minWidth: 0, borderTopWidth: 3, borderTopColor: colors.accent }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Icon name="Ticket" size={13} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700", fontFamily: "monospace" }}>{current.identifier}</Text>
                </View>
                <PriorityMark priority={current.priority} t={t} showLabel />
              </View>
              <StatusBadge status={current.status} statusType={current.statusType} t={t} />
            </View>
            <Text style={t.cardTitle}>{current.title}</Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, backgroundColor: colors.surface0, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
              <MetaItem icon="Folder" label="Project" value={current.project || "—"} t={t} />
              <MetaItem icon="Users" label="Team" value={current.team || "—"} t={t} />
              <MetaItem icon="Tag" label="Labels" chips={issueLabelChips(current).map(({ label, color }) => ({ label, color }))} t={t} />
              {current.assignee !== undefined && <MetaItem icon="UserRound" label="Assignee" value={current.assignee || "Unassigned"} t={t} />}
              <MetaItem icon="Calendar" label="Created" value={formatIssueDate(current.createdAt)} t={t} />
              <MetaItem icon="Clock" label="Updated" value={formatRelativeDate(current.updatedAt)} t={t} />
              {current.dueDate && <MetaItem icon="CalendarClock" label="Due" value={formatIssueDate(current.dueDate)} t={t} />}
              {current.estimate ? <MetaItem icon="Hash" label="Estimate" value={`${current.estimate} pts`} t={t} /> : null}
            </View>

            {detail && statusChangesText(detail.context) && <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="History" size={13} color={colors.foregroundMuted} />
              <Text style={{ ...t.muted, fontSize: 12 }}>Status history: {statusChangesText(detail.context)}</Text>
            </View>}

            {detail && <CustomerRequests t={t} requests={detail.customerRequests ?? []} platform={layout.platform} />}

            {!!relatedTickets.length && <View style={{ gap: 10 }}>
              <Button title={`${showRelatedTickets ? "Hide" : "Show"} related tickets · ${relatedTickets.length}`} icon={showRelatedTickets ? "ChevronUp" : "ChevronDown"} chosen={showRelatedTickets} stretch onPress={() => setShowRelatedTickets(!showRelatedTickets)} />
              {showRelatedTickets && <View style={{ gap: 8 }}>
                <FieldLabel title="Related tickets" icon="GitBranch" hint="your assigned tickets are highlighted" t={t} />
                {relatedTickets.map((ticket) => <Pressable key={`${ticket.relationLabel}:${ticket.id}`} accessibilityRole="button" accessibilityLabel={`View ${ticket.relationLabel} ticket ${ticket.identifier}: ${ticket.title}${ticket.assignedToViewer ? ", assigned to you" : ""}`} onPress={() => chooseRelated(ticket)}
                style={({ pressed }) => ({ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, borderWidth: ticket.assignedToViewer ? 2 : 1, borderColor: ticket.assignedToViewer ? colors.accent : colors.border, borderRadius: 10, padding: 10, backgroundColor: pressed || ticket.assignedToViewer ? colors.surface2 : colors.surface0 })}>
                  <Text style={{ ...t.eyebrow, color: colors.accent, width: 76, textTransform: "capitalize" }}>{ticket.relationLabel}</Text>
                  <Text style={{ ...t.mono, color: colors.accent }}>{ticket.identifier}</Text>
                  <Text numberOfLines={1} style={{ ...t.strong, flex: 1, minWidth: 140 }}>{ticket.title}</Text>
                  <Text style={{ ...t.muted, color: ticket.assignedToViewer ? colors.accent : colors.foregroundMuted, fontWeight: ticket.assignedToViewer ? "700" : "400" }}>{ticket.assignedToViewer ? "Assigned to you" : ticket.assignee || "Unassigned"}</Text>
                  {!!ticket.status && <StatusBadge status={ticket.status} statusType={ticket.statusType} t={t} />}
                  <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
                </Pressable>)}
              </View>}
            </View>}

            {(linkedAgentsLoading || linkedAgents.length > 0) && <View style={{ gap: 8 }}>
              <FieldLabel title="Paseo agents" icon="Bot" hint={linkedAgentsLoading ? "loading linked agents…" : `${linkedAgents.length} linked`} t={t} />
              {linkedAgents.slice(0, 4).map((linked) => <View key={linked.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1, minWidth: 180 }}>
                  <Text numberOfLines={1} style={t.strong}>{linked.title || `Agent ${linked.id.slice(0, 8)}`}</Text>
                  <Text style={t.muted}>{linked.status} · {formatRelativeDate(linked.updatedAt)}</Text>
                </View>
                {navigation ? <Button title="Open agent" icon="ArrowUpRight" size="sm" onPress={() => navigation.openAgent({ agentId: linked.id })} /> : <Text selectable style={t.mono}>{linked.id}</Text>}
              </View>)}
            </View>}

            <Divider t={t} spaced />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <FieldLabel title="Description" icon="FileText" t={t} />
              {detailLoading && <ActivityIndicator color={colors.accent} size="small" />}
            </View>
            {detailLoading && !detail && <View style={{ gap: 9 }}><Skeleton t={t} width="100%" height={12} /><Skeleton t={t} width="92%" height={12} /><Skeleton t={t} width="64%" height={12} /></View>}
            {detailError && <Callout t={t} tone="danger" message={detailError} action={<Button title="Retry" icon="RefreshCw" size="sm" onPress={() => setDetailVersion((value) => value + 1)} />} />}
            {detail && <>
              <MarkdownPreview markdown={detail.issue.description || "No description provided."} t={t} platform={layout.platform} />
              {detail.warnings.map((warning) => <Callout key={warning} t={t} message={warning} />)}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Button title={showContext ? "Hide agent context" : "Preview agent context"} icon="FileText" onPress={() => setShowContext(!showContext)} />
                <Button title={contextCopied ? "Copied" : "Copy context"} icon={contextCopied ? "Check" : "Copy"} onPress={copyContext} />
              </View>
              {showContext && <ScrollView style={{ maxHeight: 320, backgroundColor: colors.surface0, borderRadius: 10, borderWidth: 1, borderColor: colors.border }} contentContainerStyle={{ padding: 14 }} nestedScrollEnabled>
                <Text selectable style={t.mono}>{detail.context}</Text>
              </ScrollView>}
            </>}
          </View>

          {agent ? <View style={{ ...t.card, gap: 14, flex: splitDetail ? 1 : undefined, width: splitDetail ? undefined : "100%", minWidth: 0 }}>
            <SectionHeading title="Agent started" subtitle="The first message includes the ticket card and full context." icon="CircleCheck" t={t} />
            {agent.warnings.map((warning) => <Callout key={warning} t={t} message={warning} />)}
            {navigation
              ? <Button title="Open agent" icon="ArrowUpRight" primary stretch onPress={() => navigation.openAgent({ agentId: agent.agentId })} />
              : <Text selectable style={t.mono}>Agent ID: {agent.agentId}</Text>}
            <Button title="Start another agent" icon="RotateCcw" onPress={() => { setAgent(null); launchRequest.current = null; }} />
          </View> : <View style={{ ...t.card, gap: 14, flex: splitDetail ? 1 : undefined, width: splitDetail ? undefined : "100%", minWidth: 0 }}>
            <SectionHeading title="Start a ticket agent" subtitle="Choose a workspace and model, then add any direction." icon="Bot" t={t} />
            {optionsError && <Callout t={t} message={optionsError} action={<Button title="Reload" icon="RefreshCw" size="sm" onPress={() => void loadOptions()} />} />}

            <SectionHeading title="1. Workspace" subtitle="Choose where the agent will work." icon="Folder" t={t} />
            <FieldLabel title="Workspace" icon="Folder" hint="where the agent runs" t={t} />
            <ChoicePicker label="Projects" icon="Folder" placeholder="Choose a project" options={projects.map((item) => ({ id: item.projectId, label: item.projectCustomName || item.projectDisplayName, description: item.projectRootPath }))}
              value={projectId} onChange={(id) => { mappedFor.current = selected?.id ?? null; setWantedBranch(null); setMappingReason(null); if (id !== projectId) { setProjectId(id); setBaseBranch(""); setBranches([]); } }} t={t} disabled={Boolean(busy) || optionsLoading} />
            {mappingReason && project && <Text style={t.muted}>{mappingReason === "label" ? `Mapped from the label ${mappingLabels.join(", ")}. Change it under Settings → Repository mappings.`
              : mappingReason === "recent" ? "The project you used last. Map this ticket's labels under Settings → Repository mappings to choose per label."
                : `${mappingReason === "saved" ? `Last used for ${mappingSource ? mappingLabel(mappingSource) : "this Linear project"}.` : "Matched by the Linear project name."} Starting an agent remembers the project you choose.`}</Text>}
            {mappingReason !== "label" && mappingLabels.length > 1 && <Text style={t.muted}>Labels {mappingLabels.join(", ")} map to different projects, so none was preselected from them.</Text>}
            {!optionsLoading && !projects.length && <Callout t={t} tone="info" message="Open a project in Paseo, then reload the choices." />}
            {project?.projectKind === "git" && <>
              <FieldLabel title="Base branch" icon="GitBranch" hint="new worktree starts here" t={t} />
              <ChoicePicker label="Branches" icon="GitBranch" placeholder="Choose a base branch" options={branches} value={baseBranch} onChange={(id) => { mappedFor.current = selected?.id ?? null; setWantedBranch(null); setMappingReason(null); setBaseBranch(id); }} t={t} disabled={Boolean(busy) || branchesLoading} />
              {branchesLoading && <ActivityIndicator color={colors.accent} />}
              {branchesError && <Callout t={t} tone="danger" message={branchesError} />}
              {!branchesLoading && !branches.length && !branchesError && <Callout t={t} tone="info" message="No branches found. The repository needs at least one commit." />}
              <Text style={t.muted}>Creates a new ticket branch in its own worktree from this branch. Remote branches use the locally fetched version.</Text>
              <Button title="Refresh branches" icon="RefreshCw" size="sm" disabled={branchesLoading} onPress={() => { setWantedBranch({ ...(baseBranch ? { branch: baseBranch } : {}) }); setBranchesFor(null); setBranchesVersion((value) => value + 1); }} />
            </>}
            {project && project.projectKind !== "git" && <Text style={t.muted}>The agent will work in this project’s directory.</Text>}

            <Divider t={t} spaced />
            <SectionHeading title="2. Agent" subtitle="Choose a provider and model." icon="Bot" t={t} />
            <FieldLabel title="Provider" icon="Bot" hint={`${models.length} model${models.length === 1 ? "" : "s"} available`} t={t} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {providerGroups.map((group) => <Button key={group} leading={<ProviderMark provider={group} theme={theme} size={15} />} title={`${group} · ${models.filter((model) => model.provider === group).length}`} chosen={providerGroup === group}
                onPress={() => { if (group !== providerGroup) selectProvider(group); }} />)}
            </View>
            {optionsLoading && <View style={{ gap: 9 }}><Skeleton t={t} width="40%" height={12} /><Skeleton t={t} width="100%" height={48} radius={10} /></View>}
            {!optionsLoading && !models.length && <Callout t={t} tone="info" message="Configure an agent provider in Paseo, then reload the choices." />}
            {providerGroup && <>
              <FieldLabel title="Model" icon="Cpu" t={t} />
              <ChoicePicker label="Models" icon="Cpu" placeholder="Choose a model" options={models.filter((model) => model.provider === providerGroup)} value={provider} onChange={(id) => {
                const model = models.find((candidate) => candidate.id === id);
                setProvider(id); setThinkingOptionId(model?.defaultThinkingOptionId ?? model?.thinkingOptions.find((option) => option.isDefault)?.id ?? "");
              }} leading={<ProviderMark provider={providerGroup} theme={theme} size={15} />} t={t} disabled={Boolean(busy)} />
              {(activeModes.length > 0 || thinkingOptions.length > 0) && <Disclosure title={["Mode and reasoning", activeModes.find((mode) => mode.id === modeId)?.label, thinkingOptions.find((option) => option.id === thinkingOptionId)?.label].filter(Boolean).join(" · ")} t={t}>
                {!!activeModes.length && <>
                  <FieldLabel title="Change mode" icon="SlidersHorizontal" t={t} />
                  <ChoicePicker label="Modes" icon="SlidersHorizontal" placeholder="Use provider default" options={[{ id: "", label: "Provider default", description: "Use the default mode configured in Paseo." }, ...activeModes]} value={modeId} onChange={setModeId} t={t} disabled={Boolean(busy)} />
                </>}
                {!!thinkingOptions.length && <>
                  <FieldLabel title="Reasoning" icon="BrainCircuit" t={t} />
                  <ChoicePicker label="Reasoning" icon="BrainCircuit" placeholder="Choose a reasoning level" options={thinkingOptions} value={thinkingOptionId} onChange={setThinkingOptionId} t={t} disabled={Boolean(busy)} />
                  <Text style={t.muted}>Reasoning levels come directly from this model’s Paseo provider.</Text>
                </>}
              </Disclosure>}
            </>}
            <Button title="Reload projects and models" icon="RefreshCw" size="sm" disabled={optionsLoading} onPress={() => void loadOptions()} />

            <Divider t={t} spaced />
            <SectionHeading title="3. Direction" subtitle="Ticket context is included automatically." icon="MessageSquare" t={t} />
            <FieldLabel title="Additional instructions" icon="MessageSquare" hint="optional" t={t} />
            <TextInput accessibilityLabel="Additional instructions for the agent" editable={!busy} multiline maxLength={10000} value={instructions} onChangeText={setInstructions}
              placeholder="Anything the agent should know before it starts…" placeholderTextColor={colors.foregroundMuted} style={{ ...t.input, minHeight: 84, textAlignVertical: "top" }} />

            <Divider t={t} spaced />
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Button title="Settings" icon="Settings" size="sm" disabled={Boolean(busy)} onPress={() => setView("settings")} />
              <Text style={{ ...t.muted, flex: 1, minWidth: 160 }}>{markInProgress ? "Ticket will be marked In Progress at launch." : "Ticket stays in its current state at launch."} {templateSaved ? "Custom default prompt active." : "Built-in default prompt."}</Text>
            </View>

            <View style={{ backgroundColor: colors.surface0, borderRadius: t.radius.md, padding: 16, marginTop: 4, gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <Icon name={agentLinearAccess ? "KeyRound" : "Lock"} size={16} color={colors.foregroundMuted} />
                <Text style={{ ...t.muted, flex: 1 }}>{agentLinearAccess ? "Linear tools enabled: the agent can comment, update status, and attach links to this ticket." : "Linear access disabled: the agent is instructed to leave Linear unchanged unless you ask."}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Icon name={canLaunch ? "CircleCheck" : "CircleDashed"} size={14} color={canLaunch ? colors.statusSuccess : colors.foregroundMuted} />
                <Text style={{ ...t.muted, flex: 1 }}>{canLaunch ? "Ticket context included. Ready when you are." : missingRequirement}</Text>
              </View>
              <Button title="Start agent with ticket" icon="Rocket" primary stretch disabled={!canLaunch} onPress={launch} />
            </View>
          </View>}
        </View>
      </> : <>
        <View style={{ ...t.card, gap: 16 }}>
          <View style={{ ...t.input, paddingVertical: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon name="Search" size={17} color={colors.foregroundMuted} />
            <TextInput accessibilityLabel="Search tickets" value={query} onChangeText={setQuery} placeholder="Search loaded tickets — and all of Linear…" placeholderTextColor={colors.foregroundMuted} style={{ color: colors.foreground, paddingVertical: 12, fontSize: 14, flex: 1, minWidth: 0 }} />
            {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" style={({ pressed }) => ({ minWidth: t.touchTarget, minHeight: t.touchTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })} onPress={() => setQuery("")}><Icon name="X" size={15} color={colors.foregroundMuted} /></Pressable>}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Segmented t={t} label="Layout" value={layoutMode} disabled={Boolean(busy)} onChange={(value) => {
              setLayoutMode(value);
              // Columns already split tickets by status; a status chip would leave a single column.
              if (value === "board" && status) changeStatus(null);
            }} options={[{ value: "list" as const, label: "List", icon: "List" }, { value: "board" as const, label: "Board", icon: "Columns3" }]} />
          </View>
          {(() => {
            const quick = quickLabels(issues, filter.labels);
            return quick.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {quick.map(({ ref, color }) => {
                const chosen = filter.labels.some((item) => labelRefKey(item) === labelRefKey(ref));
                return <Button key={labelRefKey(ref)} size="sm" title={labelRefDisplay(ref)} chosen={chosen}
                  leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color ?? colors.accent }} />}
                  onPress={() => changeFilter(toggleLabel(filter, ref))} />;
              })}
            </View> : null;
          })()}
          {layoutMode === "list" && <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <FieldLabel title="Status" icon="ListFilter" t={t} />
            <Button size="sm" title={`All · ${counts ? (counts.complete ? counts.total : `${counts.total}+`) : issues.length}`} chosen={status === null} onPress={() => changeStatus(null)} />
            {statuses.map(([name, count]) => <Button key={name} size="sm" title={`${name} · ${count}`} chosen={status === name} leading={<StatusMark status={name} statusType={statusTypeFor(name)} t={t} />}
              onPress={() => changeStatus(status === name ? null : name)} />)}
          </View>}
          <Disclosure title={`Filters and sort${activeFilterCount(filter) + (dependency !== "all" ? 1 : 0) ? ` · ${activeFilterCount(filter) + (dependency !== "all" ? 1 : 0)} active` : ""}`} t={t}>
            <ListFilters t={t} filter={filter} onChange={changeFilter} labels={workspaceLabels} labelsError={labelsError} onRetryLabels={() => setLabelsVersion((value) => value + 1)}
              customers={customers} customersAvailable={customersAvailable} disabled={Boolean(busy)} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <FieldLabel title="Dependencies" icon="GitBranch" t={t} />
              <Button size="sm" title="All" chosen={dependency === "all"} onPress={() => changeDependency("all")} />
              <Button size="sm" title="Blocking others" icon="Flag" chosen={dependency === "blocking"} onPress={() => changeDependency(dependency === "blocking" ? "all" : "blocking")} />
              <Button size="sm" title="Blocked" icon="Lock" chosen={dependency === "blocked"} onPress={() => changeDependency(dependency === "blocked" ? "all" : "blocked")} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <FieldLabel title="Sort" icon="ArrowDownUp" t={t} />
              <Segmented t={t} label="Sort field" value={dateField} onChange={(value) => setDateField(value)}
                options={[{ value: "updatedAt" as SortField, label: "Updated", icon: "Clock" }, { value: "createdAt" as SortField, label: "Created", icon: "Calendar" }, { value: "dueDate" as SortField, label: "Due", icon: "CalendarClock" }, { value: "priority" as SortField, label: "Priority", icon: "Flag" }]} />
              <Segmented t={t} label="Sort direction" value={dateDirection} onChange={(value) => setDateDirection(value)}
                options={[{ value: "newest" as SortDirection, label: dateField === "dueDate" ? "Latest" : dateField === "priority" ? "Highest" : "Newest", icon: "ArrowDown" }, { value: "oldest" as SortDirection, label: dateField === "dueDate" ? "Soonest" : dateField === "priority" ? "Lowest" : "Oldest", icon: "ArrowUp" }]} />
            </View>
          </Disclosure>
          {!!(status || query || dependency !== "all" || activeFilterCount(filter)) && <Button size="sm" title="Clear filters" icon="X" onPress={clearFilters} />}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ ...t.muted, fontWeight: "600" }}>{visible.length} of {issues.length} tickets{!showClosed ? " (open)" : ""}{cursor ? " loaded" : ""}{status ? ` · ${status}` : ""}{lastUpdatedAt ? ` · Updated ${formatRelativeDate(lastUpdatedAt)}` : ""}</Text>
          <Text style={t.muted}>Sorted by {dateField === "priority" ? (dateDirection === "newest" ? "priority · highest first" : "priority · lowest first") : dateField === "dueDate" ? (dateDirection === "newest" ? "due date · latest first" : "due date · soonest first") : dateField === "updatedAt" ? (dateDirection === "newest" ? "last updated · newest first" : "last updated · oldest first") : dateDirection === "newest" ? "date created · newest first" : "date created · oldest first"}</Text>
        </View>

        {!busy && !visible.length && <EmptyState t={t} icon={issues.length ? "Search" : "CircleCheck"} title={issues.length ? "No matching tickets" : "You’re all caught up"}
          description={issues.length ? "Try another status or a different search term."
            : activeFilterCount(filter) || status || dependency !== "all" ? "No tickets match these filters."
              : showClosed ? "Assigned tickets will appear here as soon as Linear has them." : "No open tickets are assigned to you right now. Enable the closed-states setting to also see finished work."}
          action={!!(status || query || dependency !== "all" || activeFilterCount(filter)) ? <Button title="Clear filters" icon="X" onPress={clearFilters} /> : undefined} />}

        {layoutMode === "board" && !!visible.length && <TicketBoard t={t} issues={visible} disabled={Boolean(busy)} onOpen={choose}
          // Server counts cover every assignment; with a local search they would overstate the columns.
          countsByName={query.trim() ? null : counts?.byName ?? null}
          canLoadMore={Boolean(cursor)} onLoadAll={() => void run("Loading all tickets", loadAllIssues)} />}

        {layoutMode === "list" && (!!visible.length || ticketsLoading) && <View style={{ backgroundColor: colors.surface1, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
          {!compact && <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.surface2 }}>
            <View style={{ width: 20 }} />
            <Text style={{ ...t.eyebrow, width: 82 }}>Issue</Text>
            <Text style={{ ...t.eyebrow, flex: 1 }}>Title</Text>
            <Text style={{ ...t.eyebrow, width: 130 }}>Status</Text>
            <Text style={{ ...t.eyebrow, width: 88, textAlign: "right" }}>{dateField === "priority" ? "Priority" : dateField === "dueDate" ? "Due date" : dateField === "updatedAt" ? "Updated" : "Created"}</Text>
            <View style={{ width: 14 }} />
          </View>}
          {ticketsLoading && !visible.length && [0, 1, 2, 3].map((row) => <View key={row} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 18, borderTopWidth: row ? 1 : 0, borderTopColor: colors.surface2 }}>
            <Skeleton t={t} width={14} height={14} radius={7} />
            <Skeleton t={t} width={64} height={12} />
            <Skeleton t={t} width={`${52 + row * 8}%`} height={14} />
            <View style={{ flex: 1 }} />
            <Skeleton t={t} width={86} height={18} radius={9} />
          </View>)}
          {visible.map((issue, index) => renderIssueRow(issue, index))}
        </View>}

        {layoutMode === "board" && ticketsLoading && !visible.length && <View style={{ flexDirection: "row", gap: 14 }}>
          {[0, 1, 2].map((column) => <View key={column} style={{ width: compact ? 272 : 304, gap: 10 }}>
            <Skeleton t={t} width={120} height={14} />
            <Skeleton t={t} width="100%" height={96} radius={12} />
            <Skeleton t={t} width="100%" height={96} radius={12} />
          </View>)}
        </View>}

        {cursor && <View style={{ ...t.card, alignItems: "center", gap: 10 }}>
          <Text style={{ ...t.muted, textAlign: "center" }}>Search and sorting apply to loaded tickets. Load all to include every ticket in this view.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            <Button title="Load more" icon="ChevronDown" onPress={() => void run("Loading tickets", async () => { await loadIssues(cursor); })} />
            <Button title="Load all tickets" icon="Layers" onPress={() => void run("Loading all tickets", loadAllIssues)} />
          </View>
        </View>}

        {searchTerm.length >= 2 && (searching || searchResults.length > 0 || searchError) && <View style={{ ...t.card, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <SectionHeading title="Across Linear" subtitle={`Workspace-wide matches for “${searchTerm}”`} icon="Search" t={t} />
            {searching && <ActivityIndicator color={colors.accent} size="small" />}
          </View>
          {searchError && <Callout t={t} tone="danger" message={searchError} action={<Button title="Retry" icon="RefreshCw" size="sm" onPress={() => setSearchVersion((value) => value + 1)} />} />}
          {remoteVisible.length ? <View style={{ backgroundColor: colors.surface1, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
            {remoteVisible.map((issue, index) => renderIssueRow(issue, index))}
          </View> : !searching && !searchError && <Text style={t.muted}>No other tickets in this workspace match “{searchTerm}”.</Text>}
        </View>}
      </>}
    </>}
  </ScrollView></SurfaceProvider>;
}
