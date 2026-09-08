---
"@okfit/mcp": minor
---

## Features

First usable release of `@okfit/mcp`: a Model Context Protocol server, `okfit-mcp`, exposing an OKF bundle to agents over stdio. The server is read-only — no tool or resource ever writes to the bundle, the config, or anywhere else.

The server resolves its project root as `OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → the process's current working directory, with no command-line flags.

### Six tools

| Tool | Returns |
| --- | --- |
| `describe_vocabulary` | Resolved project/bundle roots, active profile, agent actor, and the config's declared type and tag vocabulary. |
| `list_concepts` | Concept summaries, filterable by type, tags, and status; paginated with `limit`/`offset`. |
| `get_concept` | One concept's full decoded frontmatter, raw markdown text, bundle-relative path, and outgoing links. |
| `concept_neighbors` | A concept's graph neighbours — everything it links to and everything that links to it. |
| `stale_report` | Every concept past its `stale_after` instant, as of now or an explicit instant. |
| `validate_bundle` | The same conformance and lint report `okfit validate --format json` produces. |

### Two resources

`okf://index` re-reads the bundle's root `index.md` from disk on every call. `okf://concept/<id>` registers one static resource per concept, loaded when the server starts; edits to an already-listed concept are picked up live, but a concept added or removed after boot needs a server restart to appear.

A failing tool call reaches the client as `isError: true`, with the remediation hint folded into the message text, across five typed error cases: `ConfigError`, `BundleNotFound`, `ConceptNotFound`, `UnknownVocabulary`, and `InvalidArgument`.
