---
type: Interface
title: okfit-mcp — MCP tool and resource contract
description: The okfit-mcp server's six read-only tools, its two resource kinds, and the McpToolError union every tool declares.
kind: mcp
resource: ../../packages/mcp/src
status: stable
generated:
  by: okfit/claude-code
  at: 2026-10-11T20:51:30Z
tags:
  - architecture
verified:
  - by: human:spencer
    at: 2026-09-24T00:18:14.360Z
  - by: human:spencer
    at: 2026-10-11T15:55:11Z
  - by: human:spencer
    at: 2026-10-11T22:01:13Z
integrity:
  generated:
    body: cb38ca5d85a6aeb9
  verified:
    by: human:spencer
    at: 2026-10-11T22:01:13Z
    content: 276a313c93dbad08
---

# okfit-mcp — MCP tool and resource contract

## Tools

| Tool | Returns | Key argument/filter | Primary failure mode |
| --- | --- | --- | --- |
| `describe_vocabulary` | The resolved project and bundle roots, active profile, configured agent actor, the config's declared type and tag vocabulary, and `docs_presets`. | none (`Tool.EmptyParams`) | a refusal when config resolution fails |
| `list_concepts` | Concept summaries, paged, with a total match count. | optional exact `type`, `tags` (AND), `status`, `verified` (boolean: `true` is current, `false` is never verified), `drifted`, `stale` (with optional `now`), `limit`/`offset` | a refusal for an undeclared type or tag |
| `get_concept` | One concept's whole decoded frontmatter, raw markdown, bundle-relative path, trust `tier`, `integrity`, `stale`, `drift` (`reason`, `edited_by`, `edited_at`) when drifted, and every outgoing link. | `id` (tolerant: with or without a leading slash or trailing `.md`) | a refusal for an unknown or empty id |
| `concept_neighbors` | A concept's graph neighbours — everything it links to and everything that links to it — each with node kind and, for a concept target, its full summary. | `id` | a refusal for an unknown or empty id |
| `stale_report` | Every concept whose `stale_after` instant has passed, each with its summary and days past, plus a `drifted` list of the concepts edited since their verification. | optional `now` (ISO-8601, explicit offset) | a refusal for an unparseable `now`, or when the config or bundle fails to load |
| `validate_bundle` | The same conformance and lint report `okfit validate --format json` produces, unchanged (including the `verified-drift` lint at its configured severity): `engine_version` and `okf_version` match the CLI's over one bundle, while `okfit_version` is this package's own version, `producer` is `@okfit/mcp`, and `distribution` names the meta-package the server was launched through or is `null`. | optional `now`; optional `documents: [{ path, text }]` (bundle-relative posix `.md` paths) validated in place of disk, a not-yet-written file under an existing directory included, nothing written | `BundleNotFound`; `InvalidArgument` for a document path that is absolute, escapes the bundle, is not `.md`, repeats, or sits under a directory that does not exist |

Every concept summary carries `tier`, `integrity` and `stale`, computed from the profile's `Trust.evaluate` whether or not the `verified-drift` lint is on.

`docs_presets` lists the resolved profile's docs-surface presets, each with `name`, `description`, `additive` and `surfaces` (`file`, `frontmatter`, `body`); the docs skills write those surfaces as Surface concepts. It is `[]` when the profile is `none` or unresolved.

## Resources

- `okf://index` — the bundle's root `index.md`, read from disk on every
  request.
- `okf://concept/<id>` — one static resource per concept, registered when
  the server starts. Content is read from disk per request, so an edit to
  an already-listed concept's file is live; a concept added or removed
  mid-session appears only after the server restarts, since the list
  itself is fixed at boot.

Both resource kinds declare mime type `text/markdown`. Their descriptions
carry no trust state: they are fixed at boot, and a snapshot of drift taken
then would mislead later in the session.

## Errors

`McpToolError` is `@effected/mcp`'s `ToolRefusal`, every tool's declared
failure schema. A refusal covers config discovery, parsing or validation
failing, an unreadable bundle root, an unknown concept id, a type or tag
the config does not declare (the message lists the valid names), and a
tool argument that is structurally fine but semantically invalid (an
empty id, a `now` without an offset, a document path outside the bundle).
There is no per-failure tag: a caller reads the message.

A failing call reaches the client as `isError: true`, with the
remediation hint folded directly into `content[0].text` — there is no
separate structured error field on the wire.

## Crash policy

The bin installs crash guards (`McpGuard.run`, policy `exitBeforeConnect` for
both `uncaughtException` and `unhandledRejection`) before it loads the server.
A stray crash once the server is serving is logged to stderr and the server
keeps answering: every tool is read-only and reloads the bundle per call, so
there is no state to corrupt. A crash before the server is serving, or a load
that rejects, exits `1`. Every report on stderr starts with the label
`okfit-mcp:` (`okfit-mcp: uncaughtException (...)`,
`okfit-mcp: unhandledRejection: ...`, `okfit-mcp: startup failed: ...`).
Stdin EOF is a clean exit `0`.

## Strict input and malformed-frame recovery

Every served tool's `inputSchema` is closed: `additionalProperties: false`
at every object node. A call carrying an argument the schema does not
accept fails with a JSON-RPC `InvalidParams` (`-32602`) or, on a revision
that surfaces tool failures as an `isError` result instead (see the
Errors section above), an `isError: true` result -- either way naming
every unknown key path at every depth in one message, plus the accepted
params at that level, rather than only the first excess key.

Below the tool layer, the transport itself recovers from a malformed
frame rather than wedging: a stdin line that is not JSON gets a JSON-RPC
parse error (`-32700`, `id: null`) and the server keeps serving; a line
that is syntactically JSON but not a JSON-RPC request or response --
`null`, a bare scalar, an object with neither `method` nor `id` -- gets
`-32600` (`id: null`) and the server keeps serving. Both replies are
written before the offending line reaches the tool/resource dispatch this
table otherwise describes.

## Server identity

Name `okfit`, server key `mcp` (tools appear to a Claude Code agent as
`mcp__plugin_okfit_mcp__<tool>`), stdio only. The project root resolves in
this order: `OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → the process's
current working directory. Three protocol adapters are declared, in this
order: `2026-07-28` (stateless: no `initialize`, opened with
`server/discover`), then `2025-11-25` and `2025-06-18` (stateful, opened
with `initialize`); see
[The MCP server is Effect-native and lists the stateless 2026-07-28
adapter first](../decisions/mcp-protocol-versions.md) for why
those three and in that order, not restated here. The server's
`instructions` string is part of the contract: it is returned verbatim in
both the `initialize` result and the `server/discover` result, and it
states the orientation above (read-only tools, `describe_vocabulary` then
`list_concepts`, id shape, and the `structuredContent`/`isError` result
shapes) and a paragraph on the trust signals: how to weigh a drifted or
stale concept and which filters find them.
