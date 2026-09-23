---
type: Module
title: Claude Code Plugin
description: The Claude Code plugin that teaches agents OKF v0.2 and keeps a repository's okf bundle current.
status: stable
resource: ../../plugins/claude-code
kind: plugin
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-23T03:06:44Z
  body_sha256: 218c0195c45549b152f94e5ec6eb2d4cee0031cb697caba69a5793326f1e3296
---

# Claude Code Plugin

## Purpose

Teaches Claude Code OKF v0.2 and keeps a repository's `okf/` bundle current
(`plugins/claude-code/README.md:1-3`). It is a private, release-only
workspace package: `package.json` exists so changesets can version it,
`.changeset/config.json` mirrors `$.version` into `.claude-plugin/plugin.json`;
tags are cut, nothing publishes to npm; distribution is through the
`spencerbeggs/bot` marketplace, not yet listed
(`plugins/claude-code/CLAUDE.md:3-6`).

## Layout

Six skills (`okf-spec`, `okf-authoring`, `okf-config`, `okf-context`,
`okf-finalize`, `npm-readme`) and the one agent (`okf-docs`) that preloads
all six (`plugins/claude-code/CLAUDE.md:18-28`; the skills table at
`plugins/claude-code/README.md:39-46`). Two hooks
(`hooks/session-start/orientation.sh`, `hooks/post-tool-use/validate.sh`)
plus shared `hooks/lib/` helpers and `hooks/fixtures/` stdin envelopes,
tested with BATS (`plugins/claude-code/CLAUDE.md:29-40`).

## Hooks and kill switches

`SessionStart` runs on every session source (no matcher) and calls
`okfit context --format json` once, never `okfit validate` (which would
load the whole bundle just to learn where it is), turning the result into
`additionalContext` (`plugins/claude-code/README.md:65-74`). `PostToolUse`
fires on `Write|Edit`, **not** `PreToolUse`: `PreToolUse` fires before the
edited file exists on disk, and `okfit validate` has nothing to read at
that point, so a block from `PostToolUse` is a stop-and-fix signal, not a
prevention (`plugins/claude-code/CLAUDE.md:79-86`; M-20, this is a
deliberate, documented spec departure). `PostToolUse` runs `okfit
validate` with `--skip-provenance`: the git-derived fallback tier of
`generated-at-drift` costs a git walk per concept, measured taking
validate from about 0.5 s to 1.7 s on this bundle, so the edit-time hook
skips that tier while CI and the MCP `validate_bundle` tool keep it. A
migrated concept (one carrying `generated.body_sha256`) is unaffected by
the flag and is still checked, cheaply, by content comparison even at
edit time — see [A body digest inside generated detects real drift, not a
rewritten date](../decisions/profiles-body-sha256-detects-real-drift.md).
Kill switches: `OKFIT_HOOKS=off`
disables both; `OKFIT_SESSION_HOOK=off` and `OKFIT_VALIDATE_HOOK=off`
disable one each; comparison is exact-string `off` only
(`plugins/claude-code/CLAUDE.md:62-69`).

## Distribution and MCP status

Tagged but never published to npm (`CLAUDE.md:3-6`). `.claude-plugin/plugin.json`
registers `mcpServers.mcp`, running `bin/start-mcp.sh`, which resolves the
consuming repo's own `node_modules/.bin/okfit-mcp` and falls back to `npx
--yes @okfit/mcp`; the six tools it exposes are named explicitly in
`agents/okf-docs.md`'s `tools:` block and reach an agent as
`mcp__plugin_okfit_mcp__<tool>` (`plugins/claude-code/CLAUDE.md:88-90`; see
`okf/interfaces/okfit-mcp.md`).

`.claude-plugin/plugin.json` also registers `lspServers.okfit`, running
`bin/start-lsp.sh --stdio` through `sh`, for the `.md` extension
(`extensionToLanguage`) with `diagnostics: true`; the loader resolves
`node_modules/.bin/okfit-lsp` first and falls back to
`npx --yes @okfit/lsp`, the same shape as `bin/start-mcp.sh` — see
[LSP](lsp.md). The server starts lazily, on the first `Edit` or `Write` of
a `.md` file in the session, and publishes diagnostics batched into the
model's context on the next `Edit` or `Write`; they are advisory only and
never block a tool call, unlike the `PostToolUse` hook above. Claude Code
runs at most one language server per file extension per session, and the
first one registered wins (`plugins/claude-code/README.md`'s §6.4 note on
the LSP server) — another markdown LSP plugin loaded earlier in the same
session shadows this one entirely, with no fix available while OKF bundle
files remain plain `.md`. This is Claude Code's own behaviour, not
something this plugin's manifest opts into or could opt out of.
