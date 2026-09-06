# @okfit/mcp

Model Context Protocol server for [okfit](https://github.com/spencerbeggs/okfit). Gives agents structured access to an Open Knowledge Format bundle: concepts, types, tags, the link graph, and staleness.

> **Part of the okfit kit.** Most users want **[@okfit/plugin](https://www.npmjs.com/package/@okfit/plugin)**, which pulls this package in automatically and launches this server through the Claude Code plugin's `mcpServers.mcp` entry.

## What it is

`@okfit/mcp` speaks MCP over stdio for one OKF bundle. It is read-only: no
tool or resource ever writes to the bundle, the config, or anywhere else.
Six tools cover orientation, discovery, and validation; two resources
expose the bundle's own markdown to a client's @-mention UI.

## Launching it

Most users never invoke this directly — the Claude Code plugin's
`bin/start-mcp.sh` loader resolves the project's own
`node_modules/.bin/okfit-mcp` and falls back to `npx --yes @okfit/mcp` when
it is not installed. To run it directly, the package's own bin is
`okfit-mcp`.

The server resolves its project root in this order:
`OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → the process's current working
directory. No command-line flags are read.

## Tools

| Tool | Returns |
| --- | --- |
| `describe_vocabulary` | The resolved project and bundle roots, active profile, agent actor, and the config's declared type and tag vocabulary. Call first, before filtering or writing anything. |
| `list_concepts` | Concept summaries, optionally filtered by an exact type, by tags that must all be present, and by status; pages with `limit`/`offset` and reports the total match count. |
| `get_concept` | One concept by id: its whole decoded frontmatter, the file's raw markdown text, its bundle-relative path, and every outgoing link. |
| `concept_neighbors` | A concept's graph neighbours — everything it links to and everything that links to it — each with its node kind and, for a concept target, its full summary. |
| `stale_report` | Every concept whose `stale_after` instant has passed, each with its summary and how many whole days past it, as of now or an explicit instant. |
| `validate_bundle` | The same conformance and lint report `okfit validate --format json` produces, unchanged. |

## Resources

- `okf://index` — the bundle's root `index.md`, re-read from disk on every
  call.
- `okf://concept/<id>` — one **static** resource per concept loaded when
  the server starts, one per concept in the bundle at that moment. Editing
  an already-listed concept's file is picked up live on every read; a
  concept added or removed after boot is not reflected in `resources/list`
  until the server restarts. There is no URI template and no completion —
  every concept resource is registered by its own literal URI.

## Errors

A failing tool call reaches the client as `isError: true`, with the
remediation text folded directly into the message — there is no separate
structured error field on the wire. The five `McpToolError` members:

- `ConfigError` — config discovery, parsing, or validation failed.
- `BundleNotFound` — the configured bundle root does not exist or could
  not be read.
- `ConceptNotFound` — no concept in the bundle has the requested id.
- `UnknownVocabulary` — a requested type or tag name is not declared in
  the resolved config.
- `InvalidArgument` — a tool argument was structurally acceptable but
  semantically invalid.

## License

[MIT](LICENSE)
