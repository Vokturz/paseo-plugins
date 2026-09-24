# Linear → Paseo project mapping, and ticket-scoped Linear access for agents

Branch `feat/linear-project-mapping` of Vokturz/paseo-plugins.
Asked by Teo on 2026-09-24: "map workspaces with Paseo Linear so agents can work on Linear tasks", scope chosen
"mapping + agents update Linear", location chosen "fork, install from path".

## Scope

1. **Project mapping.** A Linear project (or the team, for tickets without a project) maps to a Paseo project and,
   for Git projects, a base branch. Opening a ticket preselects the mapped project and branch. Without a mapping it
   preselects the Paseo project whose name equals the Linear project name (case-insensitive, unique match only).
   A successful launch records the mapping; Settings lists mappings and can forget them.
2. **Agent Linear access.** Agents started from a ticket get a stdio MCP server, `linear_ticket`, bound to that one
   issue: read it (fresh state, comments, team states), comment on it, move it to a named workflow state of its team,
   and attach a link (for example the PR). The default prompt tells the agent to use them; a Settings toggle turns it off.

Out of scope: auto-starting agents from Linear, acting on other tickets, and agents that were not launched from a ticket.

## Assumptions

- Agents run as the same Unix user as the daemon, so the MCP server reads the key the same way the plugin does:
  `LINEAR_API_KEY`, then `$PASEO_HOME/linear-tickets/credentials.json`. **The key is never written into agent config**:
  Paseo persists agent config, env overrides are not persisted, and the MCP args carry only the issue id and the path.
- `node` on the daemon's PATH runs the MCP script (v26 here). The script is plain ESM JS with no dependencies.
- Paseo accepts `mcpServers: { name: { type: "stdio", command, args } }` on `agent.create` (agent-sdk-types.ts:22).

## Architecture

- `shared/mapping.ts` — pure: mapping key (`project:<id>` / `team:<id>`), resolver (saved mapping → name match → none).
- `server/settings.ts` — `projectMappings` (≤200 entries, validated) and `agentLinearAccess` (default true), patch ops
  `projectMapping` (set) and `forgetProjectMapping` (key).
- `server/linear.ts` / `context.ts` — detail gains `projectId`, `projectName`.
- `server/launch.ts` — adds the `linear_ticket` MCP server when access is on; records nothing (the client saves mapping).
- `server/ticket-mcp.mjs` — MCP stdio server (initialize, tools/list, tools/call, ping), JSON-RPC line protocol,
  every query and mutation pinned to `--issue <id>`; the state tool resolves a name only within the issue's team.
- `shared/contracts.ts` — default prompt gains `{{linear_access}}`; templates without it get the block appended.
- Client — preselect on detail load unless the user already picked; restore the mapped branch when it exists;
  save mapping after launch; Settings card lists mappings with Forget, plus the access toggle.

## Work items

1. mapping resolver + tests  2. settings fields + tests  3. detail projectId  4. MCP server + tests (fake Linear)
5. launch injection + prompt + tests  6. client wiring  7. typecheck, test, compile via `paseo plugin install`
8. adversarial review (credential handling) → fix  9. switch a host install from npm to a local path install, verify.

## Acceptance

- Opening a ticket whose Linear project name uniquely matches a Paseo project preselects it with its default branch, with no saved mapping.
- After launching into project X from Linear project P, the next P ticket preselects X and the same branch.
- A launched agent lists the `linear_ticket` tools; `get_ticket` returns its issue; `add_comment` posts to that issue only;
  `set_status` with an unknown or other-team state is refused; a key never appears in `~/.paseo/agents` records.
- Access toggle off → no MCP server and the prompt forbids Linear writes, as upstream does.
- `npm run typecheck` clean; `npm test` green with the new cases.

## Risk

- The agent can still read the credentials file or env key itself (true before this change); the MCP scoping narrows
  the *intended* path, it is not a sandbox. Documented in the README.
- Name match can pick a wrong project when names collide; only a unique match preselects, and the user sees the choice.
- Swapping the npm install for the path install must keep `~/.paseo/linear-tickets` (credentials, settings) — back it up first.

## Verification commands

```bash
cd linear-tickets && npm run typecheck && npm test
paseo plugin install ./linear-tickets --id linear-tickets
paseo plugin ls | grep linear-tickets ; paseo plugin logs linear-tickets
```
