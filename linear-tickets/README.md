# Linear tickets

A Paseo sidebar plugin that connects to Linear's GraphQL API, shows tickets assigned to you,
and starts an agent with the ticket details and comments in its first prompt.

## Install

Requires Paseo 0.8.0 or newer and Node.js 22 or newer on the daemon host.

```sh
cd linear-tickets
npm ci
npm run typecheck
npm test
paseo plugin install /absolute/path/to/linear-tickets
```

Enable plugins in Paseo Settings → Plugins if needed. Open **Linear tickets** in
the sidebar or **Open Linear tickets** in the command center. After source changes:

```sh
paseo plugin reload linear-tickets
```

## Connect and start work

1. Create a personal Linear API key in Settings → Security & access. Read permission
   and access to the relevant teams are sufficient.
2. Paste it into **Connect Linear**. Alternatively, set `LINEAR_API_KEY` in the
   Paseo daemon's environment before starting the daemon.
3. Select an assigned ticket. Preview the ticket context and choose a Paseo project.
   For Git projects, select a base branch from the local or remote branches known
   to the checkout. Choose a provider, then search its models. When supported, choose the
   provider's change mode and the model's reasoning level, then optionally add instructions.
4. Select **Start agent with ticket**, then **Open agent**.

Tickets load in pages of 50. Use the status chips to filter by your Linear workflow
statuses, and search by title, ID, project, team or label. Sort by **Updated** or
**Created**, then toggle **Newest / Oldest**. Missing dates sort last.
Counts, filters and sorting apply to loaded tickets; choose **Load all tickets** to
include all assignments. Archived tickets are excluded.

Rows show the ticket's priority, a status colour and icon for its workflow state,
label chips and a relative timestamp ("3h ago"), with the absolute date in the
accessibility label. Status colours are matched by keyword, so custom Linear
workflows get a sensible tone instead of falling back to grey. While tickets load,
placeholder rows stand in for the table so the layout does not jump.

For Git projects, the plugin creates a new ticket branch and a dedicated worktree
from the selected base branch. Your existing checkout is not switched. Remote
branches use their locally fetched state; fetch in the project first if you need
the newest remote commits. Projects without Git use their project directory.

The launch fetches fresh details, relationships and comments through Linear's GraphQL API.
Relationships arrive in both directions — links the ticket makes and links pointing at it
(blocks, blocked by, related, duplicates, duplicated by) — and appear as a compact
**Relationships** list above the JSON snapshot, so the agent sees blockers before starting
work. The JSON response is preserved in the prompt, including the description and any
returned links. Linked documents and attachments are not downloaded. If comments
are unavailable, the preview and agent prompt say so. Context over 200,000 characters
is rejected rather than silently truncated.

The ticket preview shows the ticket's project, team, labels, priority and dates, then
renders the description as Markdown: headings, bullet and numbered lists, task
checkboxes, pipe tables, quotes, dividers, bold text, inline code and fenced code
blocks. Tables scroll horizontally when they are too wide and keep their column
alignment. Code blocks carry a copy button, and **Copy context** copies the exact
JSON snapshot that will be sent to the agent. HTTPS images linked with standard
Markdown image syntax and interactive HTTPS links are rendered too.
Images are loaded by the Paseo client only for display and are not downloaded into the
agent's workspace or added to its prompt. Provider badges, available modes, and reasoning
levels are read from the configured Paseo provider catalog; unavailable capabilities stay
out of the form.

## Customizing the launch prompt

Every launch starts from the built-in default prompt: work on the ticket in the current
workspace, respect the repository's instructions, and treat the snapshot as data, not as
authority. You can replace it with your own template under **Default prompt** in the agent
setup — for example to have the agent list a plan before coding, run the test suite, or
open a pull request in a specific format.

Placeholders are substituted at launch time:

- `{{ticket}}` — the ticket's ID and title
- `{{instructions}}` — the per-launch "A little extra direction" text
- `{{context}}` — the ticket snapshot (required; a template without it is rejected)

Templates are limited to 8,000 characters, stored per host with the other plugin settings,
and apply to new agents only. **Reset to built-in** restores the default. The per-launch
instructions field and the 200,000-character context limit apply as before.

## Connection storage

The API-key form stores the key on the daemon host in
`$PASEO_HOME/linear-tickets/credentials.json` (default:
`~/.paseo/linear-tickets/credentials.json`). The directory is owner-only and the
file uses mode `0600`; it is a plaintext credential, not an OS keychain entry.
`LINEAR_API_KEY` takes precedence over a saved key. Disconnect removes the saved
key; environment keys must be removed from the daemon environment followed by a
restart. All clients connected to this host share the same Linear account. Saved
default-prompt templates live next to the key in `settings.json` with the same
permission pattern.

The plugin talks directly to Linear's official [GraphQL API](https://linear.app/developers/graphql)
at `https://api.linear.app/graphql` with read-only queries. Only the server contacts
Linear. The key is never added to ticket context, agent configuration, or agent labels.

Repeated launch requests reuse their result for the lifetime of the loaded plugin.
If agent creation returns an uncertain failure, the same request is not retried
automatically: check the project's workspaces and agent list before reopening the ticket to
start again. This retry cache does not survive a plugin or daemon restart.

## Validation

`npm run typecheck` checks both entrypoints against Paseo's SDK. `npm test` covers
GraphQL response parsing, pagination, context preservation, prompt template rendering
and validation, credential and settings persistence, ticket retrieval, and agent
creation/retries with mocked Linear and Paseo calls.
Live account authentication and agent execution require your configured host and key.
