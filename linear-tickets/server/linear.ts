import type { TicketDetail } from "../shared/contracts";
import { buildContext, normalizeIssue, issuePage, connection, record } from "./context";
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
      project { name identifier url }
      team { name key }
      labels(first: 50) { nodes { id name } }
      createdAt
      updatedAt
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const COUNT_ISSUES_QUERY = `query countIssues($first: Int!, $after: String) {
  issues(first: $first, after: $after, includeArchived: false, orderBy: updatedAt, filter: { assignee: { isMe: { eq: true } } }) {
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
      project { name identifier url }
      team { name key }
      labels(first: 50) { nodes { id name } }
      createdAt
      updatedAt
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

// The list filter is built in TypeScript so it stays deterministic (deduped, sorted)
// across caching, tests and request logging. An explicit state-name selection always
// wins over the "active only" default: picking the Done chip means seeing Done tickets.
export function listIssueFilter(stateNames?: string[], activeOnly?: boolean): Record<string, unknown> {
  const filter: Record<string, unknown> = { assignee: { isMe: { eq: true } } };
  const state: Record<string, unknown> = {};
  const names = [...new Set((stateNames ?? []).map((name) => name.trim()).filter(Boolean))].sort();
  if (names.length) state.name = { in: names };
  else if (activeOnly) state.type = { nin: ["completed", "canceled"] };
  if (Object.keys(state).length) filter.state = state;
  return filter;
}

export const ISSUE_DETAIL_QUERY = `query issueDetail($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    state { name type }
    branchName
    priorityLabel
    project { id name identifier url }
    team { id name key }
    labels(first: 50) { nodes { id name } }
    createdAt
    updatedAt
    parent { id identifier title url }
    children(first: 50) { nodes { id identifier title url } }
    relations(first: 50) { nodes { type issue { id identifier title url } relatedIssue { id identifier title url } } }
    inverseRelations(first: 50) { nodes { type issue { id identifier title url } relatedIssue { id identifier title url } } }
    attachments(first: 50) { nodes { id title url } }
    documents(first: 50) { nodes { id title url } }
  }
}`;

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
    const data = await this.post(key, VIEWER_QUERY, {});
    const viewer = data.viewer;
    if (!viewer || typeof viewer !== "object" || typeof (viewer as { id?: unknown }).id !== "string") {
      throw new Error("Linear did not confirm this API key. Check it in Linear settings and reconnect.");
    }
    await this.credentials.save(key);
    return this.status();
  }

  async disconnect() {
    await this.credentials.remove();
    return this.status();
  }

  private async withKey<T>(work: (key: string) => Promise<T>): Promise<T> {
    const { key } = await this.credentials.read();
    if (!key) throw new Error("Connect Linear before loading tickets.");
    return work(key);
  }

  async issues(cursor?: string, stateNames?: string[], activeOnly?: boolean) {
    return this.withKey(async (key) =>
      issuePage(record(await this.post(key, LIST_ISSUES_QUERY, { first: 50, after: cursor ?? null, filter: listIssueFilter(stateNames, activeOnly) })).issues));
  }

  // Linear's GraphQL exposes no aggregation, so chip counts come from a bounded pass over
  // every assignment (25 pages x 50). `complete` is false when the cap was hit; the client
  // then shows counts as a lower bound instead of pretending they are exact.
  async countIssues(): Promise<{ total: number; byName: Record<string, number>; byType: Record<string, number>; complete: boolean }> {
    return this.withKey(async (key) => {
      const byName: Record<string, number> = {};
      const byType: Record<string, number> = {};
      let total = 0;
      let after: string | null = null;
      let complete = false;
      for (let page = 0; page < 25; page++) {
        const data = record(await this.post(key, COUNT_ISSUES_QUERY, { first: 50, after }));
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
      return { issue, warnings, context: buildContext(issueData, comments) };
    });
  }
}
