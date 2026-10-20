# GitHub reviews

A Paseo sidebar view with **Review requested** and **Created by me** tabs for open
GitHub pull requests. Lists the repository, PR number, title, author, labels,
draft status and last update. Select a row to open the PR in your browser.

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
across all accessible repositories. **Review requested** (the default tab) uses
`is:pr is:open review-requested:LOGIN`.
As documented in [GitHub search](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-pull-request-review-status-and-reviewer),
this includes requests directed to you and teams you belong to. It shows pending
requests, rather than every PR you have ever reviewed. PRs leave the results when
the request is satisfied, removed, or the PR closes; changes can take time to
appear in GitHub's search index.

**Created by me** uses `is:pr is:open author:LOGIN` to show your own open PRs,
including drafts, regardless of review requests. Merged and closed PRs are
excluded. Switching tabs starts at page one and clears the previous list;
responses from the previous tab cannot overwrite the newly selected list.

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

Edit the multiline **Review prompt** to describe what to check and how to
report findings. A default prompt covers actionable bugs, regressions,
security, verification, and file/line references. **Restore default prompt**
replaces the draft; **Save reviewer setup** persists your selected provider,
model, agent mode, reasoning, and prompt together. Prompts must be nonempty and are limited to 16,000
characters. **Discard changes** restores the last saved setup.

Reviewer configuration uses a separate local, host-scoped settings document,
shared by both PR tabs and preserved across reloads and restarts. Concurrent
edits use revision checks. This view configures the reviewer for future review
runs; saving it does not launch an agent or publish anything to GitHub.

## Local filters

Open **Filters → Edit filters** to narrow both tabs:

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
updates it immediately. There is no daemon background poller or event listener.
Failed refreshes preserve the last successful page and display the error. Partial
search results and GitHub's 1,000-result search cap are explicitly shown.

This version only reads GitHub data. It does not create reviewer agents or post
reviews, comments, approvals or other changes to GitHub. Each refresh runs two
bounded, read-only `gh api` commands on the host: resolve the current user, then
search the selected PR list. Editing owner filters also reads the current user
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
failures, and unavailable saved selections.
