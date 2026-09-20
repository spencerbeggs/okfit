---
type: Interface
title: okfit-mcp — MCP tool and resource contract
description: The okfit-mcp server's six read-only tools, its two resource kinds, and the McpToolError union every tool declares.
kind: mcp
resource: ../../packages/mcp/src
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-20T01:54:25Z
  body_sha256: a3cd51f8eb2baefe93404ce291f5ddcc7c2b8f00751d4d996900c3637149b78f
tags:
  - architecture
---

# okfit-mcp — MCP tool and resource contract

## Tools

| Tool | Returns | Key argument/filter | Primary failure mode |
| --- | --- | --- | --- |
| `describe_vocabulary` | The resolved project and bundle roots, active profile, configured agent actor, and the config's declared type and tag vocabulary. | none (`Tool.EmptyParams`) | `ConfigError` |
| `list_concepts` | Concept summaries, paged, with a total match count. | optional exact `type`, `tags` (AND), `status`, `limit`/`offset` | `UnknownVocabulary` for an undeclared type or tag |
| `get_concept` | One concept's whole decoded frontmatter, raw markdown, bundle-relative path, and every outgoing link. | `id` (tolerant: with or without a leading slash or trailing `.md`) | `ConceptNotFound`, `InvalidArgument` for an empty id |
| `concept_neighbors` | A concept's graph neighbours — everything it links to and everything that links to it — each with node kind and, for a concept target, its full summary. | `id` | `ConceptNotFound`, `InvalidArgument` |
| `stale_report` | Every concept whose `stale_after` instant has passed, each with its summary and days past. | optional `now` (ISO-8601, explicit offset) | `ConfigError` |
| `validate_bundle` | The same conformance and lint report `okfit validate --format json` produces, unchanged: `engine_version` and `okf_version` match the CLI's over one bundle, while `okfit_version` is this package's own version, `producer` is `@okfit/mcp`, and `distribution` names the meta-package the server was launched through or is `null`. | optional `now` | `BundleNotFound` |

## Resources

- `okf://index` — the bundle's root `index.md`, read from disk on every
  request.
- `okf://concept/<id>` — one static resource per concept, registered when
  the server starts. Content is read from disk per request, so an edit to
  an already-listed concept's file is live; a concept added or removed
  mid-session appears only after the server restarts, since the list
  itself is fixed at boot.

Both resource kinds declare mime type `text/markdown`.

## Errors

`McpToolError` is a union of five tagged members, every tool's declared
failure schema:

- `ConfigError` — config discovery, parsing, or validation failed.
- `BundleNotFound` — the configured bundle root does not exist or could
  not be read.
- `ConceptNotFound` — no concept in the bundle has the requested id.
- `UnknownVocabulary` — a requested type or tag name is not declared in
  the resolved config.
- `InvalidArgument` — a tool argument was structurally acceptable but
  semantically invalid.

A failing call reaches the client as `isError: true`, with the
remediation hint folded directly into `content[0].text` — there is no
separate structured error field on the wire.

## Server identity

Name `okfit`, server key `mcp` (tools appear to a Claude Code agent as
`mcp__plugin_okfit_mcp__<tool>`), stdio only. The project root resolves in
this order: `OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → the process's
current working directory. Three protocol adapters are declared, in this
order: `2026-07-28` (stateless: no `initialize`, opened with
`server/discover`), then `2025-11-25` and `2025-06-18` (stateful, opened
with `initialize`); see
[The MCP server is Effect-native and lists the stateless 2026-07-28
adapter first](../decisions/mcp-stateless-first-protocol-list.md) for why
those three and in that order, not restated here. The server's
`instructions` string is part of the contract: it is returned verbatim in
both the `initialize` result and the `server/discover` result, and it
states the orientation above (read-only tools, `describe_vocabulary` then
`list_concepts`, id shape, and the `structuredContent`/`isError` result
shapes).
