# linear-tickets — implementation brief: Tier 1, Tier 2, and the launch state update

Status: **in progress.** Tiers 1 and 2 landed; Tier 3 (opt-in `issueUpdate` on launch) in flight. Every endpoint, field and filter below was validated
against the live Linear GraphQL schema *and* the real `Overwatch-ai` workspace (read-only)
on 2026-02 — the evidence line under each item is real response data, not documentation
recall. (51 → 59 tests as items land.)

Scope: Tier 1 (context accuracy), Tier 2 (list UX), and exactly one Tier 3 item
(`issueUpdate` on launch). Other Tier 3 items (completion comments, `attachmentLinkGitHubPR`,
`issueVcsBranchSearch`, Linear agent sessions) are deliberately **out of scope**.

## Ground rules

These apply to every item in this brief.

- **No new dependencies.** The Linear client is hand-rolled `fetch` GraphQL behind the
  `Post` seam in `server/linear.ts`. Keep it that way.
- **Keep the seams.** `Post = (key, query, variables) => Promise<Record<string, unknown>>`
  stays the only transport injection point, so every test runs with mocked `Post`/`fetch`.
- **Keep `LinearService`'s public surface stable**: `status()`, `authenticate(key)`,
  `disconnect()`, `issues(...)`, `detail(id)`. Extend, do not reshape.
- **Never write to Linear from a test.** Mutation tests use a mocked `Post` only.
- **`npm run typecheck` and `npm test` must be green** at the end of each item.
  The suite is currently 51 tests, all passing.
- **Update the READMEs** (`linear-tickets/README.md`, and the root table row if the pitch
  changes) whenever user-visible behavior or a documented limitation changes.
- **Contract changes are breaking for the client** — `shared/contracts.ts` is imported by
  both entrypoints, so a schema change requires the client edit in the same commit.
- **Auth subtlety (do not regress):** the GraphQL API takes the **raw** API key in
  `authorization`. A `Bearer` prefix is rejected with
  `400 INPUT_ERROR: It looks like you're trying to use an API key as a Bearer token.`
  There is a regression test pinning this.

## Architecture map (where things live)

| File | Role |
|---|---|
| `server/linear.ts` | Query constants (`VIEWER_QUERY`, `LIST_ISSUES_QUERY`, `ISSUE_DETAIL_QUERY`, `COMMENT_QUERY`), `postGraphQL`, `LinearService` |
| `server/context.ts` | `normalizeIssue`, `connection`, `issuePage`, `buildContext`, `buildPrompt` (template rendering) |
| `server/launch.ts` | `Launcher`: dedupe by `requestId`/fingerprint, worktree+branch naming, agent creation |
| `server/settings.ts` | `Settings`: persisted `{ template }` in `~/.paseo/linear-tickets/settings.json` |
| `server/credentials.ts` | API key storage (`LINEAR_API_KEY` env wins) |
| `shared/contracts.ts` | `defineRpc` schemas + `DEFAULT_PROMPT_TEMPLATE`; imported by client and server |
| `client/linear-tickets.tsx` | The surface: list, filters, ticket detail, launch form |
| `client/issue-list.ts` | `filterIssues`, `statusCounts`, `statusTone` (keyword-based), date helpers |
| `client/ui.tsx` | `StatusBadge`, `statusAccent` (keyword-based) |

Current list query (the baseline every diff below starts from):

```graphql
export const LIST_ISSUES_QUERY = `query listIssues($first: Int!, $after: String) {
  issues(first: $first, after: $after, includeArchived: false, orderBy: updatedAt, filter: { assignee: { isMe: { eq: true } } }) {
    nodes {
      id
      identifier
      title
      description
      url
      state { name }
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
```

---

# Tier 1 — accurate context (small, low risk, do first)

## 1.1 Capture relationships in both directions (`inverseRelations`) ✅ done

**Why.** Linear relations are directional. `Issue.relations` only contains relations where
this issue is the *source*; anything pointing *at* the ticket lives in
`Issue.inverseRelations`. We currently fetch only `relations`, so the agent silently
receives an incomplete picture — and blockers are exactly the thing an agent should know
before starting work.

**Evidence (live).** Tickets with **empty `relations` but non-empty `inverseRelations`**:

```
OW-1731: relations[-] inverse[related:OW-1732→OW-1731]
OW-1710: relations[-] inverse[related:OW-1719→OW-1710, related:OW-1716→OW-1710]
OW-1735: relations[blocks:OW-1735→OW-1741] inverse[-]
```

Today OW-1731 and OW-1710 would reach the agent with **no relationship context at all**.

**Change — `ISSUE_DETAIL_QUERY`.** Add the inverse connection next to `relations`:

```graphql
relations(first: 50) { nodes { type issue { id identifier title } relatedIssue { id identifier title } } }
inverseRelations(first: 50) { nodes { type issue { id identifier title } relatedIssue { id identifier title } } }
```

**Semantics — do this carefully.** A raw dump of both lists is confusing because the same
link appears twice (once as A→B in `relations`, once as B→A in `inverseRelations`). Normalize
into directed statements before they reach the prompt:

- In `relations`, `issue` is the subject (the ticket), `relatedIssue` is the object:
  `type: "blocks"` ⇒ *this ticket blocks X*; `type: "related"` ⇒ *related to X*;
  `type: "duplicate"` ⇒ *this ticket duplicates X*.
- In `inverseRelations`, the direction flips: `type: "blocks"` with
  `issue: OTHER, relatedIssue: THIS` ⇒ **this ticket is blocked by OTHER**.
- Also handle `type: "duplicated"`/inverse duplicates as *duplicated by*.

Draw the line by `issue.id === thisIssue.id`, then label each entry
(`blocks`, `blocked by`, `related`, `duplicates`, `duplicated by`). De-duplicate identical
`(direction, otherId)` pairs.

**Suggested shape.** Add a pure helper in `server/context.ts`, e.g.
`export function relationships(issueData: unknown): Array<{ direction: string; identifier: string; title: string; url?: string }>`,
use it inside `buildPrompt` only (keep `normalizeIssue`/the `Issue` contract unchanged, since
the snapshot JSON passed to `buildPrompt` already carries the raw fields), and render a
compact "Relationships" block above the JSON snapshot:

```
Relationships:
- blocked by ENG-43: Blocked work
- blocks ENG-44: Child task
- related to ENG-45
```

**Tests.**

- Both directions present ⇒ both appear, correctly labelled.
- Relations-only and inverse-only inputs ⇒ each produces the right label (the OW-1731 case:
  inverse-only must still surface).
- Self-referencing/duplicate pairs are not emitted twice.
- `relations`/`inverseRelations` absent ⇒ no crash, no empty "Relationships:" header.

**Acceptance.** A ticket whose only relationship exists as an inverse relation (e.g. the
OW-1731 shape) produces label-correct relationship context in the prompt.

## 1.2 Exact workflow category (`WorkflowState.type`) ✅ done

**Why.** The client currently guesses status colors by keyword-matching state *names*
(`statusTone` in `client/issue-list.ts`, `statusAccent` in `client/ui.tsx`). Workspace state
names are arbitrary — this workspace has `In Review`, `Todo`, `Done`, `Duplicate` — so the
heuristic mis-tones custom workflows. `WorkflowState.type` is the stable category.

**Evidence (live).** `WorkflowState.type` is a **`String` field, not an enum** (confirmed via
introspection: `WorkflowState.type: String`). Observed values in this workspace:

```
backlog | unstarted | started | completed | duplicate | canceled
```

Note `duplicate` — the classic triage/backlog/unstarted/started/completed/canceled list is
**not** exhaustive. Treat `type` as an open string set with a known-value fast path and a
safe fallback; never assume a closed enum.

**Change — queries.** Add `type` to `state` in both `LIST_ISSUES_QUERY` and
`ISSUE_DETAIL_QUERY`: `state { name type }`. (Also used by 2.1's filter UI, so land it here.)

**Change — contracts.** Add to `issueSchema` in `shared/contracts.ts`:

```ts
statusType: z.string().default(""),   // Linear's workflow category: started/completed/…
```

**Change — `normalizeIssue`.** Map `state.type` → `statusType` via the existing `label()`
helper (keeps the string-guard behavior for odd payloads).

**Change — client.** Prefer the category for tone/color, keep the name heuristic only as a
fallback when `statusType` is empty or unknown:

```ts
// client/issue-list.ts — statusTone(status, statusType?) / client/ui.tsx — statusAccent(...)
started/completed/canceled/backlog/unstarted/duplicate/triage → explicit tones
else                                                          → existing keyword match on the name
```

Thread `statusType` through `StatusBadge`/`statusAccent`/`statusTone` call sites
(`client/linear-tickets.tsx` uses them in the row, the detail header and the status chips).

**Tests.** `normalizeIssue` maps `state.type`; missing `state.type` ⇒ `""` and the keyword
fallback still tones a named state; each known category maps to a stable tone; an unknown
category (e.g. `"weird"`) falls back without throwing.

**Acceptance.** Custom-named states render with the correct semantic tone in every workspace
(specifically: `In Review` and `In Progress` both tone as "started", `Done` as "completed").

## 1.3 Use Linear's canonical branch name (`Issue.branchName`) ✅ done

**Why.** We invent `ow-1748-<uuid8>` from the identifier. Linear already computes the
branch name users expect, respecting the workspace/user branch-format setting — and if
Linear's GitHub integration matches branches to issues, using its name keeps that working.

**Evidence (live).**

```
OW-1748 branch=victor/ow-1748-define-a-pr-template-in-ow-back
OW-1662 branch=victor/ow-1662-build-a-dedicated-lido-charts-pipeline
```

**Change — queries.** Add `branchName` to `ISSUE_DETAIL_QUERY` (the detail fetch already
feeds `Launcher`). Optionally add it to the list query for display; not required.

**Change — `server/launch.ts`.** Currently:

```ts
const slug = detail.issue.identifier.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "ticket";
... branchName: `${slug}-${input.requestId.slice(0, 8)}`
```

New behavior: use Linear's `branchName` when present and safe, otherwise fall back to the
current slug logic. Guards worth having:

- Reject/fallback if the value is not a valid git ref (empty, whitespace, `..`, `~`, `^`,
  `:`, `?`, `*`, `[`, `\`, control chars, leading/trailing `/` or `.`, `@{`, trailing `.lock`).
- Branch names are **not** unique per request: unlike the synthesized name, Linear's name has
  no request suffix, so **two launches of the same ticket would collide** (the worktree
  branch already exists). Decide and document: either append the short request suffix only on
  collision (retry with `-2`, `-3`…), or keep Linear's name and let the existing workspace
  creation error surface. Recommend: try Linear's name first, and on a branch-exists failure
  retry once with `-<requestId8>` appended; never silently produce a half-created workspace.
- Keep the existing `branchName` value inside the launch fingerprint? No — the fingerprint is
  built from `input`, and `branchName` is derived from the fetched detail, which is already
  re-fetched per launch. No fingerprint change needed.

**Tests.** `branchName` present ⇒ used verbatim in `workspaces.create`; absent ⇒ current slug
fallback; unsafe value (e.g. `"bad name~1"`) ⇒ fallback, never passed through; collision retry
path exercises the suffix once.

**Acceptance.** Launching OW-1748 creates branch `victor/ow-1748-define-a-pr-template-in-ow-back`
(then a suffixed variant on a second launch of the same ticket).

---

# Tier 2 — list UX (medium; closes two documented limitations)

## 2.1 Server-side status filtering (`state: { type: { … } }`) ✅ done

**Decision log (2026-02).** Counts: **server-side** (user-confirmed) — verified live that Linear's
GraphQL has no aggregation (no `totalCount` on `PageInfo`/`IssueConnection`), so the new
`linear.count-issues` RPC runs a bounded sweep (25 pages × 50 of every assignment) and reports
`complete`; the UI shows a “+” when the cap is hit. Chips are per state **name**, not type
(deviation from the `stateTypes` sketch above — the acceptance test uses the name "In Progress",
and `state: { name: { in: [...] } }` was verified working live, composable with `type.nin`);
RPC input is `stateNames`. Default scope is **Active only** (user-confirmed) with a one-tap
All/Active toggle; pagination resets on any filter change. Live check on `Overwatch-ai`:
active-only = 41 issues; "In Progress" = exactly 2; count pass = 340 total, `complete: true`,
729ms; byName/byType match the independent first probe exactly. **Ends here.**

**Why.** The list mixes Done/Canceled into "my tickets", and filtering happens client-side
over *loaded pages only* (the README admits this: "Counts, filters and sorting apply to
loaded tickets"). Server-side filtering makes the chips correct across **all** assignments.

**Evidence (live).** Both comparators validated with real data:

```
filter: { assignee: { isMe: { eq: true } }, state: { type: { nin: ["completed","canceled"] } } }
  → OW-1748(started), OW-1662(started), OW-1735(started)

filter: { assignee: { isMe: { eq: true } }, state: { type: { in: ["started","unstarted"] } } }
  → OW-1746(unstarted), OW-1745(unstarted), OW-1739(unstarted)
```

**Change — query.** Parameterize the filter instead of hardcoding it:

```graphql
export const LIST_ISSUES_QUERY = `query listIssues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, includeArchived: false, orderBy: updatedAt, filter: $filter) {
    nodes { … state { name type } … }
    pageInfo { hasNextPage endCursor }
  }
}`;
```

Build the filter in TS: always `{ assignee: { isMe: { eq: true } } }`, plus
`state: { type: { in: [...selectedTypes] } }` when the UI has a selection. Keep the filter
object deterministic (sorted type list) so caching/tests are stable.

**Change — contracts.** Extend the list RPC input:

```ts
export const listIssuesRpc = defineRpc({
  name: "linear.list-issues",
  input: z.object({
    cursor: z.string().optional(),
    stateTypes: z.array(z.string()).max(12).optional(),  // omit ⇒ all states
  }),
  …
});
```

**Change — `LinearService.issues(cursor?, stateTypes?)`** — pass the built filter as a
variable.

**Change — client.** Status chips become **server-driven**:

- Chips must reflect counts for *all* tickets, not loaded ones. Options: (a) compute chip
  counts from the currently loaded page set and label them "loaded", or (b) fetch counts
  separately. Recommend (b) via a small dedicated query that groups by state type —
  verify first whether a count is obtainable (candidate: `issues(first: 1)` per type is
  wasteful; consider `team.states` + per-type counts, or accept "Active only / All" as the
  only server-side toggles plus client-side refinement). **Decide before implementing;
  do not silently ship misleading counts.**
- When the selected filter changes, **reset pagination** (clear `cursor`/`issues`), since the
  cursor is only valid for the same filter.
- Keep client-side filtering for search text only.
- Add an **Active only** control (maps to `nin: ["completed", "canceled"]`). Given the
  existing ticket list shows dozens of Done tickets, make this the **default** or at least
  prominent; changing the default is a UX decision — see Open decisions.

**Tests.** Filter object built correctly for: no selection, a single type, multiple types,
and "active only"; cursor reset semantics in the client; `stateTypes` validated by the RPC
schema; server test asserting the forwarded `variables.filter`.

**Acceptance.** Selecting "In Progress" shows every assigned In Progress ticket in the
workspace, not just ones inside the first loaded page.

## 2.2 Workspace-wide search (`searchIssues(term:)`)

**Why.** Current search filters loaded pages only, so you cannot find a ticket you have not
paged in — or one not assigned to you.

**Evidence (live).** Validated with pagination:

```
searchIssues(term: "charts", first: 2)
  → nodes: OW-1662, OW-1675
  → pageInfo: { hasNextPage: true, endCursor: present }
```

**Change — new RPC** in `shared/contracts.ts`:

```ts
export const searchIssuesRpc = defineRpc({
  name: "linear.search-issues",
  input: z.object({ term: z.string().trim().min(2).max(200), cursor: z.string().optional() }),
  output: z.object({ issues: z.array(issueSchema), nextCursor: z.string().nullable() }),
});
```

Query: `query searchIssues($term: String!, $first: Int!, $after: String) { searchIssues(term: $term, first: $first, after: $after) { nodes { …same field set as the list… } pageInfo { hasNextPage endCursor } } }`
Reuse `issuePage()` from `server/context.ts` for nodes/cursor handling.

**Change — client.**

- Keep the local (loaded-page) filter for instant feedback while typing.
- After a debounce (~300 ms) with a minimum term length, call the search RPC and show results
  in a clearly separated "Across Linear" group so the two result sets are never confused.
- De-duplicate against loaded tickets by `id`.
- Show a "Search all of Linear" affordance rather than surprising the user mid-typing; make
  the scope explicit in the results header.

**Tests.** RPC input validation (too-short term rejected); cursor forwarding; results merged
and de-duplicated by id; empty result set renders the empty state.

**Acceptance.** Searching for a ticket that is **not** assigned to you (and was never loaded)
returns it.

## 2.3 Due date, estimate, and state history ✅

**Why.** Cheap context wins: due dates matter for prioritisation, and `stateHistory` shows
churn ("reopened twice") which is useful before an agent picks up a ticket.

**Evidence (live).** Both fields exist (`Issue.dueDate`, `Issue.estimate`) but are **null in
this workspace** — implement defensively, and note they may simply be absent.
`stateHistory` returns spans, not from/to pairs:

```
OW-1735 stateHistory: Backlog(backlog) -> Todo(unstarted) -> In Progress(started)
OW-1748 stateHistory: Todo(unstarted) -> In Progress(started) -> Done(completed)
```

Field shape validated: `stateHistory(first: N) { nodes { state { name type } startedAt endedAt } }`
— the node type is `IssueStateSpan` and there is **no** `fromState`/`toState`.

**Change.**

- Queries: add `dueDate` `estimate` to the list; add `stateHistory(first: 20) { nodes { state { name type } startedAt endedAt } }` to the detail query.
- Contracts: `dueDate: z.string().default("")`, `estimate: z.number().nullable().default(null)`, and optionally `stateChanges: z.number().default(0)` (derived).
- Client: due-date chip on rows (with overdue emphasis) and a **Due date** sort option.
  Note: the server orders by `updatedAt` only (`PaginationOrderBy` supports `createdAt`/`updatedAt`),
  so a due-date sort is necessarily client-side over loaded pages — label it accordingly, or
  skip due-date sorting to avoid re-introducing the exact limitation 2.1 fixes.
- Prompt: include open/closed spans from `stateHistory` in the context, e.g.
  `- state history: Backlog → Todo → In Progress (open 3d)`.

**Tests.** `dueDate`/`estimate` normalization when present and when null; state-history
summarization (reopen detection: same state type appearing in non-adjacent spans);
no-history case.

**Acceptance.** A reopened ticket's prompt shows its state churn; a ticket with a due date
shows it in the list.

**Done 2026-07-08** (70/70 tests green, live-verified on OW-1748):

- **Due date**: in the list, search and detail queries; `dueDate: z.string().nullable().default(null)` in the contract; accented "Due Oct 1, 2026" chip in rows and a **Due** meta item in the preview; **Due** sort option (Latest / Soonest — client-side over loaded pages, labelled as such; missing dates last). No overdue emphasis: the chip just shows the date, since "overdue" also depends on completed states.
- **Estimate**: live probing showed `estimate` is a plain `Float` scalar (the sketch's `estimate { value }` object selection is rejected by the API), so one nullable number in the contract, shown in rows and preview when set. Not team-noisy in practice.
- **State history**: `stateHistory(first: 10)` in the detail query; well-formed spans (named state, `startedAt`) go into the JSON snapshot as `stateHistory`, and the prompt gains `Status changes: Todo → In Progress → Done (currently Done)` above it; malformed spans dropped, empty history adds nothing. The prompt line shows the full sequence, so reopen churn is visible; a derived `stateChanges` count was skipped as noise.
- Live: `OW-1748` → `stateHistory` Todo → In Progress → Done, prompt line rendered; `dueDate`/`estimate` normalize to explicit nulls (unused in this workspace, per the evidence above).

---

# Tier 3 (single item) — mark the ticket In Progress on launch

## 3.1 `issueUpdate` state transition

**Why.** The natural companion to launching an agent: the ticket should stop looking like
"Todo" the moment work starts, without the user switching to Linear.

**Evidence (live).** Mutation shape validated against the schema (payload wrapper, not the
object directly):

```graphql
mutation setState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id state { name } } }
}
```

Target state discovery validated per team:

```graphql
query { issues(first: 1, filter: { assignee: { isMe: { eq: true } } }) {
  nodes { team { id states(first: 50) { nodes { id name type position } } } } } }
```

**⚠️ The trap: a team can have several `started` states.** Real data from this workspace:

```
started:In Review | backlog:Backlog | unstarted:Todo | started:In Progress |
completed:Done | duplicate:Duplicate | canceled:Canceled
```

Matching `type === "started"` alone is **ambiguous** and would as easily move the ticket to
`In Review` as to `In Progress`. Correct resolution order:

1. An explicit user-chosen state id (setting) — most reliable.
2. Among `type === "started"` states, prefer one whose normalized name matches
   `"in progress"` (case-insensitive, trimmed).
3. Otherwise the first `started` state by `position`.
4. If no `started` state exists, do nothing and warn — never pick a `completed`/`canceled`/
   `backlog` state to satisfy "started".

**Where it runs.** In `Launcher.launch`, **after** agent creation succeeds (so a failed launch
never mutates the board), best-effort:

- Never fail the launch because the state transition failed — append a warning instead
  (`warnings` is already surfaced in the UI and in the agent card).
- Skip when the ticket is already in a state of the same `type` as the target (it is already
  "In Progress"), to avoid pointless writes and audit noise.
- The existing `requestId` dedupe means a retried identical launch does not re-run the
  mutation. State that explicitly in the code comment.

**Opt-in.** Add a `Settings` field (the settings file already exists):

```ts
// ~/.paseo/linear-tickets/settings.json  →  { "template": …, "markInProgress": true }
```

Default: **off** (this is the plugin's first write; users should opt in). Add a toggle in the
launch form ("Mark the ticket In Progress when the agent starts") plus an RPC pair
(`linear.get-settings` / `linear.set-settings`) or extend the existing prompt RPCs into a
single settings RPC — prefer consolidating into one settings contract rather than two
parallel ones, and keep the existing default-prompt RPCs working for compatibility.

**Caching.** Team states rarely change; cache `teamId → states` in memory per plugin load.
Do not persist it.

**Error semantics to implement.** The existing `postGraphQL` maps HTTP failures; a GraphQL
`errors[]` array with HTTP 200 still throws (covered by a test). For this call, catch and
convert to a warning string; do not let it escape as a launch failure.

**Tests (mocked `Post` only — never live).**

- Target picked by name among competing `started` states (regression test for the exact
  `In Review` / `In Progress` case above).
- Fallback to lowest `position` when no name matches; no-op + warning when no `started` state.
- Already-started ticket ⇒ no mutation call issued.
- Mutation failure ⇒ launch still succeeds and returns a warning.
- Setting off ⇒ no mutation call at all.
- Payload handling: `{ success: false }` ⇒ warning, `success: true` ⇒ silent.
- **Never execute this mutation against a real workspace in a test.**

**README / positioning changes (required).**

- `linear-tickets/README.md` currently states the plugin is read-only and that "the key is
  never added to…" and "A read-only key is enough — the plugin never writes to Linear."
  Once this ships, that copy is wrong. It must become: read-only by default, with an explicit
  opt-in write of a single state transition on launch; a key needs write permission only if
  that option is enabled.
- Also update the connect-screen step list in `client/linear-tickets.tsx` (step 3 in the
  connect card says a read-only key is enough) and the root README row if it claims read-only.

**Acceptance.** With the setting off, behavior is byte-identical to today. With it on,
launching an agent moves the ticket from `Todo` to `In Progress` (never `In Review`), and a
failed transition degrades to a visible warning without affecting the agent.

---

# Verification recipe

1. `npm run typecheck && npm test` in `linear-tickets/`.
2. **Read-only live check** (safe; uses the plugin's own credential store):

   ```bash
   # Reads the key the plugin already saved on this host, runs read-only queries only.
   node --import tsx -e '…LinearService with Credentials…'
   # e.g. service.issues(), service.detail(id) — print counts, never the key
   ```

3. **Probing a mutation safely:** validate shape/permissions with a **nonexistent** UUID so
   nothing can be written:

   ```graphql
   mutation { issueUpdate(id: "00000000-0000-0000-0000-000000000000", input: { stateId: "x" }) { success } }
   ```

   Expect a domain error, not a validation/permission error. **Never probe a mutation with a
   real issue id** on a live workspace.
4. Manual smoke test after implementing: connect → list (Active only) → search across Linear →
   open a ticket with inverse-only relations → confirm the relationship line in the prompt →
   launch with the state option on → confirm the ticket moved to `In Progress` and the agent
   prompt contains the template + relationships.

# Open decisions (resolved 2026-07-09)

1. **Default list scope.** ✅ **"Active only" is the default**, with an obvious All/Active
   toggle; Done tickets currently dominate the list.
2. **Status chip counts.** ✅ **Server-side count query**: chip counts reflect all assigned
   tickets, not loaded pages.
3. **Due-date sort.** ✅ **Shipped as client-side over loaded pages**, with a "loaded
   tickets only" label.
4. **Search UX.** ✅ **Explicit "Search all of Linear"**: instant local filtering while
   typing, then a clearly separated server-side results group after a ~300 ms debounce.
5. **State-update default.** ✅ **Opt-in** (setting off by default; first write of the
   plugin).
6. **Branch collision policy.** ✅ **Suffix retry**: try Linear's `branchName` first; on a
   branch-exists failure retry once with `-<requestId8>` appended.

# Suggested commit sequence

1. `feat(linear-tickets): capture issue relationships in both directions` (Tier 1.1)
2. `feat(linear-tickets): use Linear's workflow category for status tones` (Tier 1.2)
3. `feat(linear-tickets): use Linear's canonical branch name for worktrees` (Tier 1.3)
4. `feat(linear-tickets): filter ticket lists server-side by workflow state` (Tier 2.1)
5. `feat(linear-tickets): search all Linear tickets from the surface` (Tier 2.2)
6. `feat(linear-tickets): show due dates, estimates and state history` (Tier 2.3)
7. `feat(linear-tickets): optionally mark tickets In Progress on launch` (Tier 3.1)

Each commit: typecheck + tests green, README updated where behavior or limitations changed.