import { createHash } from "node:crypto";
import { DEFAULT_LIST_FILTER, type CustomerRequest, type Issue, type IssueLabel, type ListFilter, type TicketDetail } from "../shared/contracts";
import { buildContext, customerRequests, normalizeIssue, normalizeLabel, issuePage, connection, record, stateHistorySpans, label, ticketRelations } from "./context";
import { Credentials } from "./credentials";

const endpoint = "https://api.linear.app/graphql";
export type Post = (key: string, query: string, variables: Record<string, unknown>) => Promise<Record<string, unknown>>;

// GraphQL error payloads carry a user-facing message, sometimes clearer than the HTTP status alone.
function apiMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { errors?: unknown }).errors)) return "";
  const messages = (payload as { errors: unknown[] }).errors
    .map((error) => {
      if (!error || typeof error !== "object") return "";
      const e = error as { message?: string; extensions?: { userPresentableMessage?: string } };
      return e.extensions?.userPresentableMessage ?? e.message ?? "";
    })
    .filter(Boolean).join("; ");
  return messages.length > 300 ? messages.slice(0, 300) + "…" : messages;
}

export const postGraphQL: Post = async (key, query, variables) => {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      // Linear rejects the Bearer prefix for API keys on the GraphQL API.
      headers: { authorization: key, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Could not reach the Linear API. Check the host's network connection and try again.");
  }
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* Mapped by status below. */ }
  if (!response.ok) {
    const message = apiMessage(payload);
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Linear rejected this API key.${message ? ` ${message}` : ""} Check it in Linear settings and reconnect.`);
    }
    if (response.status === 429) throw new Error(`Linear is rate-limiting this host.${message ? ` ${message}` : ""} Try again in a moment.`);
    if (message) throw new Error(`The Linear API request failed: ${message}`);
    throw new Error(`The Linear API request failed (HTTP ${response.status}). Try again.`);
  }
  if (payload == null) throw new Error("Linear returned an invalid response.");
  const body = record(payload);
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const message = body.errors
      .map((error) => (error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : ""))
      .filter(Boolean).join("; ");
    throw new Error(`The Linear API request failed${message ? `: ${message}` : "."} Check your API key and ticket access, then retry.`);
  }
  return record(body.data);
};

// Labels carry their group (parent) so the UI can show "Area / Core API" and filter by group.
const LABEL_FIELDS = "labels(first: 50) { nodes { id name color parent { id name groupType } } }";

export const VIEWER_QUERY = `query viewerCheck {
  viewer { id }
}`;

export const LIST_ISSUES_QUERY = `query listIssues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, includeArchived: false, orderBy: updatedAt, filter: $filter) {
    nodes {
      id
      identifier
      title
      description
      url
      state { name type }
      priorityLabel
      priority
      dueDate
      estimate
      assignee { id name }
      project { name identifier url }
      team { name key }
      ${LABEL_FIELDS}
      needs(first: 10) { nodes { customer { id name } } }
      relations(first: 50) { nodes { type issue { id } relatedIssue { id } } }
      inverseRelations(first: 50) { nodes { type issue { id } relatedIssue { id } } }
      createdAt
      updatedAt
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const COUNT_ISSUES_QUERY = `query countIssues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, includeArchived: false, orderBy: updatedAt, filter: $filter) {
    nodes { state { name type } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// Same field set as the list query so results normalize identically. Linear's search
// covers every team the key can see, not just the user's assignments.
export const SEARCH_ISSUES_QUERY = `query searchIssues($term: String!, $first: Int!, $after: String) {
  searchIssues(term: $term, first: $first, after: $after) {
    nodes {
      id
      identifier
      title
      description
      url
      state { name type }
      priorityLabel
      priority
      dueDate
      estimate
      assignee { id name }
      project { name identifier url }
      team { name key }
      ${LABEL_FIELDS}
      needs(first: 10) { nodes { customer { id name } } }
      relations(first: 50) { nodes { type issue { id } relatedIssue { id } } }
      inverseRelations(first: 50) { nodes { type issue { id } relatedIssue { id } } }
      createdAt
      updatedAt
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

// The list filter is built in TypeScript so it stays deterministic (deduped, sorted)
// across caching, tests and request logging. An explicit state-name selection always
// wins over the default scope: picking the Done chip means seeing Done tickets. When
// closed states are not shown, completed, canceled and duplicated work is hidden.
// `groupLabelIds` maps a group name to the IDs of every label in groups of that name;
// it is only needed to express "no label of this group", which Linear has no negation for.
export function listIssueFilter(stateNames?: string[], showClosed?: boolean, relation?: "blocking" | "blocked", view: ListFilter = DEFAULT_LIST_FILTER, groupLabelIds: Record<string, string[]> = {}): Record<string, unknown> {
  const filter: Record<string, unknown> = { assignee: { isMe: { eq: true } } };
  const state: Record<string, unknown> = {};
  const names = [...new Set((stateNames ?? []).map((name) => name.trim()).filter(Boolean))].sort();
  if (names.length) state.name = { in: names };
  else if (showClosed !== true) state.type = { nin: ["completed", "canceled", "duplicate"] };
  if (Object.keys(state).length) filter.state = state;
  if (relation === "blocking") filter.hasBlockingRelations = { eq: true };
  if (relation === "blocked") filter.hasBlockedByRelations = { eq: true };
  const and: Record<string, unknown>[] = [];
  const byGroup = new Map<string, Set<string>>();
  for (const item of view.labels) {
    const names = byGroup.get(item.group) ?? new Set<string>();
    names.add(item.name);
    byGroup.set(item.group, names);
  }
  for (const [group, labelNames] of [...byGroup].sort(([a], [b]) => a.localeCompare(b))) {
    const some: Record<string, unknown> = { name: { in: [...labelNames].sort() } };
    if (group) some.parent = { name: { eq: group } };
    and.push({ labels: { some } });
  }
  for (const group of [...new Set(view.missingGroups)].sort()) {
    const ids = [...new Set(groupLabelIds[group] ?? [])].sort();
    if (ids.length) and.push({ labels: { every: { id: { nin: ids } } } });
  }
  const customerIds = [...new Set(view.customerIds)].sort();
  if (customerIds.length) and.push({ needs: { some: { customer: { id: { in: customerIds } } } } });
  else if (view.anyCustomer) and.push({ customerCount: { gt: 0 } });
  if (and.length) filter.and = and;
  return filter;
}

// A stable identity for one list configuration, used to key the cached first page.
export function listViewKey(view: ListFilter, showClosed: boolean): string {
  return createHash("sha256").update(JSON.stringify([showClosed, [...view.labels].map((item) => `${item.group}\u0000${item.name}`).sort(), [...view.missingGroups].sort(), [...view.customerIds].sort(), view.anyCustomer])).digest("hex").slice(0, 24);
}

export const WORKSPACE_LABELS_QUERY = `query workspaceLabels($first: Int!, $after: String) {
  issueLabels(first: $first, after: $after, filter: { isGroup: { eq: false } }) {
    nodes { id name color parent { id name groupType } team { id name key } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const CUSTOMERS_QUERY = `query customers($first: Int!, $after: String) {
  customers(first: $first, after: $after) {
    nodes { id name tier { name displayName } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const ISSUE_NEEDS_QUERY = `query issueNeeds($id: String!) {
  issue(id: $id) {
    needs(first: 50) { nodes { id content priority url customer { id name url tier { name displayName } } } }
  }
}`;

// Requests attached to the ticket's project but not to any ticket: the phase-level asks.
export const PROJECT_NEEDS_QUERY = `query projectNeeds($projectId: ID!) {
  customerNeeds(first: 50, filter: { project: { id: { eq: $projectId } }, issue: { null: true } }) {
    nodes { id content priority url customer { id name url tier { name displayName } } }
  }
}`;

const LABELS_TTL_MS = 5 * 60_000;
export type WorkspaceLabel = IssueLabel & { team: string };

export const ISSUE_DETAIL_QUERY = `query issueDetail($id: String!) {
  viewer { id }
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    state { name type }
    branchName
    priorityLabel
    priority
    dueDate
    estimate
    assignee { id name }
    project { id name identifier url }
    team { id name key }
    ${LABEL_FIELDS}
    createdAt
    updatedAt
    parent { id identifier title url state { name type } assignee { id name } }
    children(first: 50) { nodes { id identifier title url state { name type } assignee { id name } } }
    relations(first: 50) { nodes { type issue { id identifier title url state { name type } assignee { id name } } relatedIssue { id identifier title url state { name type } assignee { id name } } } }
    inverseRelations(first: 50) { nodes { type issue { id identifier title url state { name type } assignee { id name } } relatedIssue { id identifier title url state { name type } assignee { id name } } } }
    attachments(first: 50) { nodes { id title url } }
    documents(first: 50) { nodes { id title url } }
    stateHistory(first: 20) { nodes { state { name type } startedAt endedAt } }
  }
}`;

// A team's workflow states, used to resolve where "in progress" points at.
export type TeamState = { id: string; name: string; type: string; position: number };

export const TEAM_STATES_QUERY = `query teamStates($teamId: String!) {
  team(id: $teamId) { states(first: 50) { nodes { id name type position } } }
}`;

// The plugin's only write: move one ticket into a team's "started" state.
export const UPDATE_ISSUE_STATE_QUERY = `mutation issueUpdateState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id state { name type } } }
}`;

// Resolution order matters: a team can have several "started" states ("In Review" and
// "In Progress" in this workspace). Prefer an explicit choice, then a state named
// "in progress", then the lowest-position started state. Never pick any other type.
export function resolveStartedState(states: TeamState[], preferredId?: string): TeamState | null {
  if (preferredId) {
    const chosen = states.find((state) => state.id === preferredId);
    if (chosen) return chosen;
  }
  const started = states
    .filter((state) => state.type.trim().toLowerCase() === "started")
    .sort((a, b) => a.position - b.position);
  return started.find((state) => state.name.trim().toLowerCase() === "in progress") ?? started[0] ?? null;
}

export const COMMENT_QUERY = `query issueComments($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      nodes { id body createdAt url user { name } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export class LinearService {
  constructor(readonly credentials = new Credentials(), private readonly post: Post = postGraphQL) {}

  async status() {
    const { key, source } = await this.credentials.read();
    return { connected: Boolean(key), source };
  }

  async authenticate(key: string) {
    this.labelsCache = null;
    const data = await this.post(key, VIEWER_QUERY, {});
    const viewer = data.viewer;
    if (!viewer || typeof viewer !== "object" || typeof (viewer as { id?: unknown }).id !== "string") {
      throw new Error("Linear did not confirm this API key. Check it in Linear settings and reconnect.");
    }
    await this.credentials.save(key);
    return this.status();
  }

  async disconnect() {
    this.labelsCache = null;
    await this.credentials.remove();
    return this.status();
  }

  private async withKey<T>(work: (key: string) => Promise<T>): Promise<T> {
    const { key } = await this.credentials.read();
    if (!key) throw new Error("Connect Linear before loading tickets.");
    return work(key);
  }

  async issues(cursor?: string, stateNames?: string[], showClosed?: boolean, relation?: "blocking" | "blocked", view: ListFilter = DEFAULT_LIST_FILTER) {
    const groups = await this.groupLabelIds(view);
    return this.withKey(async (key) =>
      issuePage(record(await this.post(key, LIST_ISSUES_QUERY, { first: 50, after: cursor ?? null, filter: listIssueFilter(stateNames, showClosed, relation, view, groups) })).issues));
  }

  // Only "missing group" filters need label IDs; other filters match by name in Linear.
  private async groupLabelIds(view: ListFilter): Promise<Record<string, string[]>> {
    if (!view.missingGroups.length) return {};
    const { labels } = await this.workspaceLabels();
    const out: Record<string, string[]> = {};
    for (const item of labels) if (item.groupName && view.missingGroups.includes(item.groupName)) (out[item.groupName] ??= []).push(item.id);
    const unknown = view.missingGroups.filter((group) => !out[group]);
    if (unknown.length) throw new Error(`No Linear labels were found in the group ${unknown.map((group) => `"${group}"`).join(", ")}. Remove that filter or refresh the labels.`);
    return out;
  }

  private labelsCache: { scope: string; at: number; value: { labels: WorkspaceLabel[]; complete: boolean } } | null = null;

  // Every non-group label, with its group and team, cached for a few minutes per key.
  async workspaceLabels(refresh = false): Promise<{ labels: WorkspaceLabel[]; complete: boolean }> {
    return this.withKey(async (key) => {
      const scope = createHash("sha256").update(key).digest("hex");
      const cached = this.labelsCache;
      if (!refresh && cached && cached.scope === scope && Date.now() - cached.at < LABELS_TTL_MS) return cached.value;
      const labels: WorkspaceLabel[] = [];
      let after: string | null = null;
      let complete = false;
      for (let page = 0; page < 8; page++) {
        const data = connection(record(await this.post(key, WORKSPACE_LABELS_QUERY, { first: 250, after })).issueLabels);
        for (const node of data.nodes) {
          const item = normalizeLabel(node);
          if (!item) continue;
          const team = node && typeof node === "object" ? (node as { team?: unknown }).team : null;
          labels.push({ ...item, team: team && typeof team === "object" ? label((team as { name?: unknown }).name) : "" });
        }
        after = data.hasNextPage === true ? data.endCursor : null;
        if (!after) { complete = true; break; }
      }
      labels.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name) || a.team.localeCompare(b.team));
      const value = { labels, complete };
      this.labelsCache = { scope, at: Date.now(), value };
      return value;
    });
  }

  // Customers are a Linear feature some workspaces do not use; failures report "unavailable".
  async customers(): Promise<{ available: boolean; customers: { id: string; name: string; tier: string }[]; message?: string }> {
    return this.withKey(async (key) => {
      const customers: { id: string; name: string; tier: string }[] = [];
      try {
        let after: string | null = null;
        for (let page = 0; page < 4; page++) {
          const data = connection(record(await this.post(key, CUSTOMERS_QUERY, { first: 250, after })).customers);
          for (const node of data.nodes) {
            if (!node || typeof node !== "object") continue;
            const item = node as { id?: unknown; name?: unknown; tier?: { name?: unknown; displayName?: unknown } | null };
            if (typeof item.id !== "string" || !item.id) continue;
            customers.push({ id: item.id, name: label(item.name) || "Customer", tier: item.tier ? label(item.tier.displayName) || label(item.tier.name) : "" });
          }
          after = data.hasNextPage === true ? data.endCursor : null;
          if (!after) break;
        }
      } catch (error) {
        return { available: false, customers: [], message: error instanceof Error ? error.message : "Customers could not be loaded." };
      }
      customers.sort((a, b) => a.name.localeCompare(b.name));
      return { available: true, customers };
    });
  }

  async countIssues(showClosed?: boolean, view: ListFilter = DEFAULT_LIST_FILTER): Promise<{ total: number; byName: Record<string, number>; byType: Record<string, number>; complete: boolean }> {
    const groups = await this.groupLabelIds(view);
    return this.withKey(async (key) => {
      const byName: Record<string, number> = {};
      const byType: Record<string, number> = {};
      let total = 0;
      let after: string | null = null;
      let complete = false;
      for (let page = 0; page < 25; page++) {
        const data = record(await this.post(key, COUNT_ISSUES_QUERY, { first: 50, after, filter: listIssueFilter(undefined, showClosed, undefined, view, groups) }));
        const pageData = record(data.issues);
        for (const node of Array.isArray(pageData.nodes) ? (pageData.nodes as unknown[]) : []) {
          if (!node || typeof node !== "object") continue;
          const state = (node as { state?: { name?: unknown; type?: unknown } }).state;
          const name = state && typeof state.name === "string" && state.name ? state.name : "No status";
          const type = state && typeof state.type === "string" && state.type ? state.type : "unknown";
          byName[name] = (byName[name] ?? 0) + 1;
          byType[type] = (byType[type] ?? 0) + 1;
          total++;
        }
        const info = pageData.pageInfo && typeof pageData.pageInfo === "object" ? pageData.pageInfo as { hasNextPage?: unknown; endCursor?: unknown } : {};
        after = info.hasNextPage === true && typeof info.endCursor === "string" && info.endCursor ? info.endCursor : null;
        if (!after) { complete = true; break; } // the loop exits at the cap with more pages still available
      }
      return { total, byName, byType, complete };
    });
  }

  async searchIssues(term: string, cursor?: string) {
    return this.withKey(async (key) =>
      issuePage(record(await this.post(key, SEARCH_ISSUES_QUERY, { term: term.trim(), first: 50, after: cursor ?? null })).searchIssues));
  }

  async detail(id: string): Promise<TicketDetail> {
    return this.withKey(async (key) => {
      const data = record(await this.post(key, ISSUE_DETAIL_QUERY, { id }));
      if (!data.issue || typeof data.issue !== "object") {
        throw new Error("Linear did not return this issue. Check that you have access to it.");
      }
      const issueData = record(data.issue);
      const issue = normalizeIssue(issueData);
      const viewerId = data.viewer && typeof data.viewer === "object" ? label((data.viewer as { id?: unknown }).id) : "";
      const teamId = label(record(issueData.team ?? {}).id) || null;
      const projectId = label(record(issueData.project ?? {}).id) || null;
      const warnings: string[] = [];
      let comments: unknown[] = [];
      try {
        let after: string | null = null;
        for (;;) {
          const page = connection(record(record(await this.post(key, COMMENT_QUERY, { id: issue.id, first: 50, after })).issue).comments);
          comments.push(...page.nodes);
          after = page.hasNextPage === true ? page.endCursor : null;
          if (!after) break;
        }
      } catch {
        comments = [];
        warnings.push("Comments could not be loaded; only the ticket details are included.");
      }
      const requests = await this.customerRequests(key, issue.id, projectId).catch(() => null);
      if (!requests) warnings.push("Customer requests could not be loaded.");
      return { issue, teamId, projectId, warnings, customerRequests: requests ?? [], relations: ticketRelations(issueData, viewerId), context: buildContext(issueData, comments, stateHistorySpans(issueData), requests ?? []) };
    });
  }

  // Requests on the ticket, then project-level requests not tied to any ticket.
  private async customerRequests(key: string, issueId: string, projectId: string | null): Promise<CustomerRequest[]> {
    const issue = record(record(await this.post(key, ISSUE_NEEDS_QUERY, { id: issueId })).issue ?? {});
    const ticket = customerRequests(connection(issue.needs ?? { nodes: [] }).nodes, "ticket");
    if (!projectId) return ticket;
    const project = customerRequests(connection(record(await this.post(key, PROJECT_NEEDS_QUERY, { projectId })).customerNeeds ?? { nodes: [] }).nodes, "project");
    return [...ticket, ...project];
  }

  // The team's workflow states, cached for the plugin's lifetime; they rarely change.
  private readonly teamStatesCache = new Map<string, TeamState[]>();

  private async teamStates(teamId: string): Promise<TeamState[]> {
    const cached = this.teamStatesCache.get(teamId);
    if (cached) return cached;
    const data = record(await this.withKey((key) => this.post(key, TEAM_STATES_QUERY, { teamId })));
    const team = data.team && typeof data.team === "object" ? record(data.team) : {};
    const statesPage = team.states && typeof team.states === "object" ? record(team.states) : { nodes: [] };
    const states = connection(statesPage).nodes
      .map((node) => record(node))
      .map((node) => ({
        id: label(node.id),
        name: label(node.name),
        type: label(node.type),
        position: typeof node.position === "number" && Number.isFinite(node.position) ? node.position : Number.MAX_SAFE_INTEGER,
      }))
      .filter((state) => state.id && state.name);
    this.teamStatesCache.set(teamId, states);
    return states;
  }

  // The plugin's only write. Best-effort by design: callers surface `note` as a warning,
  // and a failure here must never turn into a launch failure.
  async markInProgress(issue: Issue, teamId: string | null): Promise<{ changed: boolean; note?: string }> {
    // Already in the team's "started" state (e.g. "In Progress"): leave it. A repeat
    // write would only add audit noise to a ticket the agent is about to work on.
    if (issue.statusType.trim().toLowerCase() === "started") return { changed: false };
    if (!teamId) return { changed: false, note: "The ticket has no team, so it could not be marked in progress." };
    let states: TeamState[];
    try {
      states = await this.teamStates(teamId);
    } catch (error) {
      return { changed: false, note: `Could not load the ticket team's states: ${error instanceof Error ? error.message : "unknown error"}` };
    }
    const target = resolveStartedState(states);
    if (!target) {
      return { changed: false, note: `The ticket's team has no \"In Progress\" state, so it was left in ${issue.status || "its current state"}.` };
    }
    let data: Record<string, unknown>;
    try {
      data = record(await this.withKey((key) => this.post(key, UPDATE_ISSUE_STATE_QUERY, { id: issue.id, stateId: target.id })));
    } catch (error) {
      return { changed: false, note: `Linear rejected the change to ${target.name}: ${error instanceof Error ? error.message : "unknown error"}` };
    }
    const result = data.issueUpdate && typeof data.issueUpdate === "object" ? record(data.issueUpdate) : {};
    if (result.success === false) {
      return { changed: false, note: `Linear reported that the change to ${target.name} was not applied; the ticket is unchanged.` };
    }
    return { changed: true };
  }
}
