import { z } from "zod";
import { MAX_PAGE, PAGE_SIZE, pullRequestSchema, reviewPageSchema, reviewTargetSchema, type PullRequest, type ReviewPage } from "../shared/contracts";
import { prKey, shaSchema } from "../shared/publication";

// Filter before paginating: matches beyond the first search page must remain visible.
// GitHub caps search at 1,000 nodes; keep both the cap and partial reads explicit.
const nodeSchema = z.object({
  databaseId: z.number().int().positive(), number: z.number().int().positive(), title: z.string(), url: z.string(),
  state: z.string(), isDraft: z.boolean(), updatedAt: z.string(), headRefOid: shaSchema,
  author: z.object({ login: z.string() }).nullable(), repository: z.object({ nameWithOwner: z.string() }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() }).nullable()) }),
  reviews: z.object({ nodes: z.array(z.object({ commit: z.object({ oid: shaSchema }).nullable() }).nullable()) }),
});
const responseSchema = z.object({
  data: z.object({ search: z.object({
    issueCount: z.number().int().nonnegative(), nodes: z.array(z.unknown()),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }) }),
  errors: z.array(z.unknown()).optional(),
});
const query = `query($search: String!, $login: String!, $after: String) {
  search(query: $search, type: ISSUE, first: 100, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      databaseId number title url state isDraft updatedAt headRefOid
      author { login } repository { nameWithOwner } labels(first: 100) { nodes { name } }
      reviews(author: $login, last: 1, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { nodes { commit { oid } } }
    } }
  }
}`;

export async function loadOutdatedReviews(
  api: (body: { query: string; variables: { search: string; login: string; after: string | null } }) => Promise<unknown>,
  input: Pick<ReviewPage, "login" | "page" | "scope" | "filters"> & { query: string },
): Promise<ReviewPage> {
  const matches = new Map<string, PullRequest>();
  const heads: Record<string, string> = {};
  const cursors = new Set<string>();
  let after: string | null = null, incomplete = false, capped = false;
  const deadline = Date.now() + 15_000;
  for (let batch = 0; batch < MAX_PAGE * PAGE_SIZE / 100; batch++) {
    if (batch && Date.now() >= deadline) { incomplete = true; break; }
    // Transport/auth failures retain their actionable error instead of becoming an empty list.
    const raw = await api({ query, variables: { search: `${input.query} sort:updated-desc`, login: input.login, after } });
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) throw new Error("GitHub could not check commits since your reviews. Refresh to try again.");
    const { search } = parsed.data.data;
    incomplete ||= Boolean(parsed.data.errors?.length);
    capped ||= search.issueCount > MAX_PAGE * PAGE_SIZE;
    for (const node of search.nodes) {
      const parsedNode = nodeSchema.safeParse(node);
      if (!parsedNode.success) { incomplete = true; continue; }
      const pr = parsedNode.data;
      if (pr.state !== "OPEN") continue;
      const reviewed = pr.reviews.nodes[0]?.commit?.oid;
      if (!reviewed) { incomplete = true; continue; }
      if (reviewed.toLowerCase() === pr.headRefOid.toLowerCase()) continue;
      const target = reviewTargetSchema.safeParse({ repository: pr.repository.nameWithOwner, number: pr.number });
      if (!target.success || pr.url.toLowerCase() !== `https://github.com/${target.data.repository}/pull/${pr.number}`) { incomplete = true; continue; }
      const key = prKey(target.data.repository, pr.number);
      matches.set(key, pullRequestSchema.parse({
        id: pr.databaseId, ...target.data, title: pr.title, url: pr.url, author: pr.author?.login ?? null,
        updatedAt: pr.updatedAt, labels: pr.labels.nodes.flatMap((label) => label ? [label.name] : []), draft: pr.isDraft,
      }));
      heads[key] = pr.headRefOid;
    }
    if (!search.pageInfo.hasNextPage) break;
    const next = search.pageInfo.endCursor;
    if (!next || cursors.has(next)) { incomplete = true; break; }
    cursors.add(next); after = next;
    if (batch === MAX_PAGE * PAGE_SIZE / 100 - 1) capped = true;
  }
  const all = [...matches.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id - b.id);
  const pullRequests = all.slice((input.page - 1) * PAGE_SIZE, input.page * PAGE_SIZE);
  return reviewPageSchema.parse({
    ...input, reviewFilter: "outdated", pullRequests, totalCount: all.length,
    nextPage: input.page * PAGE_SIZE < all.length ? input.page + 1 : null,
    incomplete, capped, fetchedAt: new Date().toISOString(),
    headsByPr: Object.fromEntries(pullRequests.map((pr) => [prKey(pr.repository, pr.number), heads[prKey(pr.repository, pr.number)]])),
    headWarning: incomplete ? "Some reviews or commits could not be checked. This list may be incomplete; refresh to try again." : null,
  });
}
