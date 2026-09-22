# Paseo plugins

Plugins that extend the [Paseo](https://paseo.sh) sidebar, surfaces and command center.
Each plugin lives in its own folder and is installed independently. See the
[plugin documentation](https://paseo.sh/docs/plugins) for the plugin API.

## Available plugins

| Plugin | Description | Requires |
| --- | --- | --- |
| [linear-tickets](./linear-tickets) | Connects to Linear's GraphQL API (read queries; optionally marks a ticket In Progress on launch), lists the tickets assigned to you, highlights blockers, and shows parent, subissue, and related tickets regardless of assignee. Filter by workflow status or dependency, search, sort, then pick a project, base branch, provider and model before launching. The launch prompt is customizable per host. | Paseo ≥ 0.8.0, Node.js ≥ 22 on the daemon host |

## Install

Install a plugin from its folder with the Paseo CLI:

```sh
cd linear-tickets
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD"
```

Enable plugins in Paseo Settings → Plugins if needed, then reload after source
changes:

```sh
paseo plugin reload linear-tickets
```

Each plugin's README covers its own setup, permissions and behavior.

## Development

Every plugin is checked with the same two commands before installing:

```sh
npm run typecheck   # tsc --noEmit against the Paseo SDK
npm test            # node --test with the plugin's own test files
```

## Adding a plugin

Create a new folder at the repository root containing `paseo-plugin.json`, the
`index.client.tsx` / `index.server.ts` entrypoints, and a README describing what
it does and what it requires. Add a row to the table above.
