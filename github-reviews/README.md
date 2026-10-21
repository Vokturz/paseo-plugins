# GitHub reviews

A Paseo sidebar view with **My reviews** and **Created by me** tabs for open
GitHub pull requests. Compact rows show the repository, PR number, title, author,
review status and relative update time. Select a PR title to open it in your browser, or
start a reviewer agent in a matching local project.

## Install

Requires Paseo 0.11.2 or newer, Node.js 22 or newer, and
[GitHub CLI](https://cli.github.com/) on the **daemon host**.

```sh
cd github-reviews
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD"
```

Local-directory installs do not run the manifest's build command. Run `npm ci`
first: it installs the SDK type dependencies and generates the prompt and MCP
entrypoint paths. If installation fails with `Could not resolve type dependency
"@getpaseo/client"`, run `npm ci` in `github-reviews`, then retry. If Paseo already
registered the failed installation, use `paseo plugin reload github-reviews`.

When already inside `github-reviews`, install `"$PWD"`; use
`"$PWD/github-reviews"` only from the repository root.

Enable the plugin in Paseo Settings → Plugins if needed. Open **GitHub reviews**
in the sidebar or **Open GitHub pull requests** in the command center.
After changing the source:

```sh
paseo plugin reload github-reviews
```

## GitHub connection

On the machine running the Paseo daemon, as the same OS user:

```sh
gh auth login --hostname github.com
```

Then select **Refresh** in the plugin. It uses the active GitHub CLI account;
`GH_TOKEN` or `GITHUB_TOKEN` in the daemon environment takes precedence over the
CLI's saved login. Switch accounts with `gh auth switch --hostname github.com`.
All clients connected to this daemon share its account. The plugin does not
store a separate token or send credentials to Paseo clients.

Private repositories must be accessible to that account and credential, including
any organization SSO authorization. GitHub Enterprise hosts are not supported in
this first version.

## What appears

The plugin queries GitHub's [search API](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests)
across all accessible repositories. **My reviews** (the default tab) uses
`is:pr is:open (review-requested:LOGIN OR reviewed-by:LOGIN)` with advanced search.
As documented in [GitHub search](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-pull-request-review-status-and-reviewer),
this includes requests directed to you or your teams and PRs you have already
reviewed. PRs you have reviewed stay in the list while they remain open and match your
saved filters. Changes can take time to appear in
GitHub's search index. The existing `review-requested` RPC scope ID is preserved
for compatibility.

Within **My reviews**, use the compact dropdown beside the tabs to choose
**All my reviews**, **Awaiting my review** (currently
requested), **Previously reviewed**, or **New commits since review**. Requests can
include a new request on a PR you reviewed earlier. The new-commits filter compares
the current head with your latest submitted GitHub review, including reviews made
outside Paseo and dismissed reviews; pending reviews are excluded. Changed heads,
including force pushes, count as needing another review. Matches are filtered
before pagination, rather than just filtering the visible page.

That comparison checks up to GitHub's first 1,000 reviewed PRs in batches of 100.
Partial reads, unavailable review commits, the search cap, or a time budget reached
between batches display a warning and a minimum count. Narrow the owner/time
filters to check more relevant PRs.

**Created by me** uses `is:pr is:open author:LOGIN` to show your own open PRs,
including drafts, regardless of review requests. Merged and closed PRs are
excluded. Switching tabs or review queues starts at page one. Each visited queue
and page is cached while this view is open, so returning displays it immediately
without another fetch. A queue or page loads once on its first visit; rapid
switches reuse any request already in progress. Responses from a previous view
cannot overwrite the newly selected list. Saved-filter changes invalidate cached
pages, and a refresh that detects an account switch clears the old account's cache.

## List layout and search

Tabs, saved filters, and page search are grouped in one toolbar. Narrow views
stack the header controls and row actions; wide views place actions beside each
PR. Review status appears in a labeled badge, and expanded details use a separate
surface. Initial loads show placeholders that respect reduced motion. If no
reviewer is configured, a setup card explains the next step.

Rows start collapsed. **Details** reveals project availability and selection,
labels, full commit IDs, exact dates, and review history. **Add instructions**
beside the review action opens the per-PR instructions field directly.
The main action is **Start review** for a new run, **Open agent** while reviewing
or when an agent needs attention, and **View review** for a verified publication.
**Run again** is a secondary action in Details and is disabled while a review is
active. The initial agent-list check completes before another run can be started.

**Search this page** instantly matches titles, repositories, authors (with or
without `@`), and PR numbers (with or without `#`). Multiple terms must all match.
The match count is separate from GitHub's total. Search never fetches data or
changes server filters; hidden rows retain their state and subscriptions. Page
controls remain available when a page has no search matches. Clear the search
to restore all loaded rows. Relative dates update with the view; exact PR and
agent update dates are available in Details and accessibility labels.

## Local projects

Each PR shows whether its repository has a registered Paseo project on this
daemon host. Matching projects appear as **Project: name**, using the custom
project name when one is set. If multiple projects point to the same repository,
all are shown. **No local project** means none of the checked projects match.
If the host's projects or a checkout cannot be inspected, the row shows
**Project check unavailable** instead of claiming the project is missing.

Matching uses the full GitHub `owner/repository` identity from each Git project's
configured remotes. It supports HTTPS, SSH, renamed checkout folders, and
worktrees. Projects with similar names or repositories belonging to different
owners are not guessed as matches. Non-Git directory projects are excluded;
SSH host aliases that do not identify `github.com` are not resolved.

Project availability is refreshed with the PR list. Checks only read local Git
configuration, with bounded parallelism and timeouts; they do not fetch, clone,
or modify repositories. The project registry belongs to the selected Paseo
host, including when viewing it from a phone or another computer.

## Reviewer setup

Select **Reviewer setup** in the PR list header, or **Configure GitHub reviewer**
in the command center, to open a separate view for your reviewer configuration.
The form follows Linear tickets' design: provider chips with brand marks, a
searchable model dropdown, matching cards and buttons, and a stacked mobile layout.

Choose a provider, then select one of its available models. Models are loaded
from the Paseo host's configured providers, with search and **Reload models**
controls. Unavailable saved models are shown explicitly and are never replaced
automatically. If one provider's catalog fails, models from other providers
remain available.

Use **Agent mode** to select a provider's execution mode, such as Claude's
**Auto mode**, or leave **Provider default** selected to use the host's default.
The **Reasoning** selector shows the selected model's advertised reasoning
levels; **Model default** leaves that choice to the model. These controls use
the same dropdowns as Linear tickets. Reasoning is hidden for models that do
not advertise it. Switching providers clears mode and reasoning choices;
switching models preserves a reasoning level only when the new model supports
it. Unavailable saved choices are shown explicitly and must be changed before
saving. Older saved setups keep their model and prompt and use default values
for the new controls.

The default review prompt lives in [DEFAULT_REVIEW_PROMPT.md](./DEFAULT_REVIEW_PROMPT.md).
The launcher reads this file on every fresh default review, and reviewer setup
loads the same file for its preview and **Restore default prompt** action.
It authorizes publishing confirmed findings as a GitHub `COMMENT` review, with
identity, snapshot, duplicate, and publication checks. It uses static inspection
and existing CI evidence, and leaves project files unchanged.

Edit the multiline **Review prompt** to use a custom prompt instead.
**Restore default prompt** switches back to following the Markdown file, including
future edits to it. **Save reviewer setup** persists your selected provider,
model, agent mode, reasoning, and prompt choice together. Custom prompts must be
nonempty and are limited to 16,000 characters. **Discard changes** restores the
last saved setup. Existing settings using the previous built-in prompt migrate
to the Markdown default; saved custom prompts and model options are preserved.

The Markdown file is included in the plugin package. Installation's `npm ci`
prepare step records its installed path for Paseo's bundled server runtime.
If the plugin directory moves, rerun `npm run prepare` and reload the plugin.
Missing, empty, or oversized default prompts produce an error before workspace
creation; the launcher does not fall back to older instructions.

Reviewer configuration uses a separate local, host-scoped settings document,
shared by both PR tabs and preserved across reloads and restarts. Concurrent
edits use revision checks. Saving it does not launch an agent or publish anything
to GitHub.

## Start a review

Save a model in **Reviewer setup**, then select **Start review** on a PR with a
matching local project. When several projects match, **Choose project** opens
Details; select one in the searchable dropdown. Both PR tabs support launching.

New reviewer agents show their first user message as a compact PR card: title,
GitHub link, branch comparison, reviewed head/base commits, and a preview of any
additional focus. Draft runs show their review-only mode. **Full instructions and
context** expands the complete original launch message. The card changes timeline
presentation; the agent still receives the entire saved prompt, extra context,
snapshot, and required publication instructions. Messages without the card marker,
including older launches, keep Paseo's normal rendering.

Select **Add instructions** beside the review action before launching to enter optional instructions or
context for that PR, such as "Look closely at session expiry and concurrent
requests." This text is added to the saved review prompt for the run; it does
not replace or change your saved reviewer setup. Up to 8,000 characters are
supported. **Clear instructions** removes it. Drafts are kept per PR while the
view is open, including across refreshes, tab changes and pagination; they are
not stored in host settings or reused for other PRs.

The server reads the saved model, mode, reasoning and prompt at launch time and
checks that the choices are still available. It rechecks the project's GitHub
remotes and loads fresh PR metadata. Closed PRs and stale project selections
are rejected before creating a workspace.

The host fetches the PR's exact head and base commits using its GitHub CLI
credentials, then creates a separate Paseo worktree and review branch at that
head commit. The original checkout's branch, index, working files and
`FETCH_HEAD` are preserved. The reviewer receives your saved prompt, PR identity,
URL, branch names, exact commits and a comparison command. Fork PRs are fetched
through the destination repository, without checking out the fork branch in
your original working directory.

Progress and errors appear beside the launch button. Repeated clicks and retries
reuse the launch request; concurrent requests for the same PR, project and instructions share
the pending launch. If workspace or agent creation cannot be confirmed, check
the project's workspaces before starting another review. After success, select
**Open agent** to see its findings. **Details → Run again** starts a fresh agent and worktree
for the same PR, loading its latest commits and your current saved reviewer setup.
It uses a new launch request; retries of a failed request still reuse that request's
ID. The previous agent stays accessible while the new launch is pending or fails.
You can edit the extra instructions before **Run again**. If you edit them after
a failed launch, the next attempt uses a new request ID for the changed context.
Older hosts without agent navigation show the agent ID instead. Created workspaces
remain available in Paseo.

Each PR restores its unarchived review agents from their saved GitHub repository
and PR-number labels on the Paseo host. Links survive page reloads, plugin reloads,
and switching clients. All unarchived runs remain listed with their title, status,
and update time, including idle or completed agents. Archiving or removing an
agent removes its link immediately; the list is also refreshed every minute and
when the app returns to the foreground. Review history and **Run again** are
available in Details. Links remain accessible even if the matching local project can
no longer be found. Failed agent-list reads show a retry action.

Starting a review with the default prompt authorizes the agent to write and
publish a GitHub `COMMENT` review containing confirmed findings, then return the
review link or a publication blocker in its conversation. The prompt excludes
approvals, request-changes reviews, merges, code edits, and unrequested thread
resolution. Custom prompts control review content and whether to publish; the
launcher always appends the required route and constraints for any publication.
There is no automatic event listener or background launcher yet.

## Review outcomes and publication

Draft PRs offer **Review draft locally** with a review-only notice before launch.
The server checks the current draft state when starting the run. Its review tool
saves validated findings locally and makes no GitHub publication requests, even
if the PR becomes ready later. Findings remain in the agent conversation; start
a new run after marking the PR ready if you want to publish. The run's mode is
preserved across retries and restarts.

Linked agents show **Reviewing**, **Reviewing locally**, **Reviewed locally**,
**Publishing…**, **Published**, **Blocked**, or **No new review**.
**Published** requires a verified GitHub submission and exposes
**View review**. Idle agents without a recorded outcome show **Outcome
unknown**; finishing a turn never counts as publication. An unfinished turn that
ends without a verified submission records a blocker. The native agent status
remains visible separately.

The row records the reviewed commit. **New commits since review** appears when
the PR's current head differs, with **Run again** available to inspect the new
snapshot. Freshness is checked whenever the PR list refreshes. Failed head
checks display a warning rather than assuming a review is current. Publication
outcomes use one batched request for linked PRs: active reviews and pending
publication refresh every ten seconds, settled reviews every minute. PRs without
linked agents do not poll outcomes. Polling pauses while the app is in the
background; foregrounding, refreshing the PR list, and agent status changes
refresh outcomes immediately. Outcomes survive reloads.
Older agents retain their links; publication is not inferred from their text.

Every new reviewer receives a `github_review` MCP server with `submit_review`,
`get_review_status`, and `report_review_blocker`. A guarded CLI fallback uses the
same handler if the provider cannot use MCP. The handler checks the effective
GitHub user ID/login, open/non-draft state, exact head/base commits, pending
reviews, fully paginated review history, and diff anchors before submitting a
single `COMMENT` review at the recorded head. It checks account/snapshot/history
again immediately before submission, then verifies the returned review and inline
comments before recording its link. A changed snapshot requires a fresh run.

Publication is serialized per PR across this host's reviewer processes. Hidden
GitHub markers and stable finding keys prevent repeated submissions and repeated
inline findings. The agent must retain the same key for the same underlying
defect and compare other authors' reports by meaning; wording alone cannot prove
that two findings describe the same bug. All-fixed acknowledgments must cover all
outstanding findings owned by the reviewer. Threads are left unchanged.

Prepared payloads and receipts are stored privately under
`$PASEO_HOME/github-reviews` (default `~/.paseo/github-reviews`), outside project
checkouts. They include review text, account identity, commit IDs, and links;
public status RPCs omit the prepared payloads. Files use owner-only permissions.
An uncertain submission blocks another write until GitHub confirms its outcome;
retry the same payload or use `get_review_status` to reconcile it. The plugin
never edits or deletes an existing pending review. These checks govern the
provided publication tools; they do not sandbox an agent's shell access.

## Local filters

Select the compact filter summary beside the review dropdown (for example,
**All owners · Any time**) to open the editor and narrow both tabs:

- **Organizations or users**: select repository owners from a two-column
  checkbox grid. The list includes your account and owners of repositories your
  GitHub account can access. **Load more owners** discovers owners from more
  repository pages. Saved selections remain visible even if they have not been
  discovered yet. A PR can belong to any selected owner; **All owners** removes
  the owner restriction. Up to 10 names and 160 total name characters are
  supported. This filters the repository's owner, not the PR's author.
- **Time window**: choose **Updated** or **Created**, then select a preset from
  a two-column grid: **Any time**, **Last 24 hours**, **Last 7 days**,
  **Last 14 days**, **Last 30 days**, **Last 90 days**, **Last 6 months**
  (180 days), or **Last year** (365 days). Previously saved custom day counts
  remain selectable. The window is rolling, measured as elapsed 24-hour days
  in UTC, and recalculated on every refresh.

Select **Save filters** to persist and apply them. **Clear filters** clears the
draft; save it to return to all owners and any time. **Cancel** discards edits.
Changes reset pagination to page one. The owner allowlist and time window are
combined with the selected tab's query in GitHub, so counts and pages cover the
filtered result set rather than filtering only the page already loaded.

Filters use Paseo's local, host-scoped plugin settings. They are stored in JSON
on the daemon machine, survive daemon restarts and plugin reloads, and are
shared by clients connected to that host. They are not saved in the repository
or in your GitHub account. Removing the plugin installation removes its settings.
Concurrent edits use revision checks so one client cannot silently overwrite
another's changes. Invalid saved settings are preserved and shown with an
explicit **Reset saved filters** action; the plugin never silently queries
without your saved restrictions.

## Refresh and pagination

Results are ordered by most recently updated, with 50 PRs per page and Previous /
Next controls. The current page refreshes every minute while the view is mounted
and the app is active, and when the app returns to the foreground. **Refresh**
fetches a fresh response immediately. Changing queues or returning to cached
pages does not trigger a refresh or restart the polling clock; the visible
**Updated** timestamp identifies the displayed response. There is no daemon
background poller or event listener.
Failed refreshes preserve the last successful page and display the error. Partial
search results and GitHub's 1,000-result search cap are explicitly shown.
Recovery guidance distinguishes missing GitHub CLI, expired authentication,
repository/SSO access, rate limits, timeouts, and unexpected responses. Login
instructions appear only when the CLI or authentication needs attention.

The plugin reads GitHub data and can create local reviewer agents. Agents using
the default prompt may publish reviews; refreshing the list remains read-only.
Each refresh resolves the current user, searches the selected PR list, and
reads current PR head commits in GraphQL batches of up to 25. All are bounded,
read-only `gh api` commands on the host. Editing owner filters also reads the current user
and accessible repository owners in pages of 100 repositories. Raw subprocess
errors and private repository details are not sent to clients.

## Validation

```sh
npm run typecheck
npm test
```

Tests mock the GitHub CLI responses and cover review-request and author query scoping, account changes,
pagination and search caps, empty and partial results, response validation, error
redaction, owner and rolling time filters, filter validation, local settings
registration and reads, owner discovery and pagination, preservation of saved
owner and time selections, and RPC registration. Live authentication and browser
handoff need a configured Paseo host. Reviewer tests cover prompt validation,
model identifier preservation, selectable model discovery, partial provider
failures, and unavailable saved selections. Project tests cover remote identity
matching, custom names, multiple checkouts, worktrees, missing directories,
partial failures, and bounded local inspection. Launch tests cover saved settings,
mode and reasoning forwarding, exact commit fetching, checkout preservation,
stale PR/project rejection, request deduplication, uncertain creation errors,
per-run instructions, validation, and separation of launches with different context.
Default prompt tests cover live Markdown reads, invalid assets, legacy migration,
custom prompt preservation, and publication instructions in the launched prompt.
Linked-agent tests cover label-based restoration, pagination, multiple runs,
archive/removal updates, stale-response races, retries, and subscription cleanup.

Publication tests cover account and snapshot changes, pending reviews, last-minute
history changes, diff anchors, concurrent publishers, duplicate findings, lost
responses and restart recovery, fix acknowledgments, private receipts, lifecycle
outcomes, and freshness comparisons. A separate MCP/CLI process test uses a fake
GitHub executable and verifies JSON submission and idempotent retry without
writing to GitHub.

Queue tests cover requested/reviewed scoping, changed heads beyond the first
search page, filtered pagination, search caps, incomplete data and error recovery.
Polling tests cover full-page batching, active/settled cadence, background pauses,
partial failures, unmounts and stale responses. Draft tests verify persistent
review-only mode, local result storage and absence of publication requests.
Presentation tests cover local search, relative-time boundaries, primary actions
for active/published/blocked reviews, missing setup and project selection.
Launch-card tests cover complete message preservation, draft mode, focus previews,
external text escaping, malformed metadata, and validated GitHub links.
