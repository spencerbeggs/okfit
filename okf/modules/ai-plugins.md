---
type: Module
title: AI Plugins
description: The pluginfinity source of the okfit agent plugin, built into a Claude Code plugin and a GitHub Copilot plugin that teach agents OKF v0.2 and keep a repository's okf bundle current.
status: stable
resource: ../../plugin
kind: plugin
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-06T04:20:11Z
  body_sha256: 1df93efd11eca0ad589f45f5811487e68af9228900ed5c455f6ddc62379ff6da
---

# AI Plugins

## Purpose

`plugin/` is one pluginfinity source (`plugin/pluginfinity.config.ts`) that
`pluginfinity build` turns into a Claude Code plugin (`plugin/builds/claude/`)
and a GitHub Copilot plugin (`plugin/builds/copilot/`); both teach an agent
OKF v0.2 and keep a repository's `okf/` bundle current
(`plugin/README.md:1-3`). It replaced the earlier Claude Code-only plugin at
`plugins/claude-code` (workspace package `@okfit/claude-code-plugin`), which
is gone along with the `plugins/` directory. `builds/` is generated,
committed and never hand-edited: edit the source, run `pnpm plugin:build`,
and `pnpm plugin:check` (`build --check`) fails when `builds/` is stale
(`plugin/CLAUDE.md:12-18`). The `pluginfinity` CLI is a root
devDependency.

It is the private workspace package `@okfit/ai-plugins`, release-only:
`package.json` exists so changesets can version it, and
`.changeset/config.json` mirrors its version into
`plugin/builds/claude/.claude-plugin/plugin.json` and
`plugin/builds/copilot/plugin.json`; tags (`@okfit/ai-plugins@<version>`,
renamed from `@okfit/claude-code-plugin@<version>` for every release
0.1.0-0.9.0) are cut and nothing publishes to npm; distribution is
through the `spencerbeggs/bot` marketplace, not yet listed
(`plugin/CLAUDE.md:3-10`). `layers.json` lists it under `tooling`.

## Layout

Ten skills (`okf-spec`, `okf-authoring`, `okf-config`, `okf-context`,
`okf-finalize`, and the docs set `docs-detect-shape`, `docs-templates`,
`docs-badges`, `docs-humanize`, `docs-render`) and two agents, split by write
direction: `okf-docs` writes the bundle (and `CLAUDE.md` pointers) and
preloads the five `okf-*` skills; `okf-publisher` writes the published pages
outside `okf/` (READMEs, `docs/`) from Surface and Publication concepts,
preloads the five `docs-*` skills, and touches the bundle only through
`okfit sync --publication` (`plugin/CLAUDE.md:20-42`; the skills table at
`plugin/README.md:41-58`). Skill and agent bodies name tools and agents with
`{{tool ...}}` and `{{agent ...}}` tokens that render per host
(`plugin/CLAUDE.md:78-86`). Two hooks
(`hooks/session-start/orientation.sh`, `hooks/post-tool-use/validate.sh`)
share `hooks/lib/okfit/okfit-cli.sh` and are declared in
`pluginfinity.config.ts`, which the build turns into each host's generated
hooks file; they run on the pluginfinity hook library. The BATS suite lives
in `plugin/__test__/` (`pnpm test:bats`) and runs the built scripts under
`builds/<target>/` once per host (`plugin/README.md:14-40`).

## Hooks and kill switches

`SessionStart` runs on every session source (no matcher) and calls
`okfit context --format json` once, never `okfit validate` (which would
load the whole bundle just to learn where it is), turning the result into
`additionalContext` (`plugin/README.md:77-87`). `PostToolUse`
fires on `Write|Edit`, **not** `PreToolUse`: `PreToolUse` fires before the
edited file exists on disk, and `okfit validate` has nothing to read at
that point, so a block from `PostToolUse` is a stop-and-fix signal, not a
prevention (`plugin/CLAUDE.md:64-76`; M-20, this is a
deliberate, documented spec departure — see [The validate hook fires
PostToolUse, not
PreToolUse](../decisions/plugin-posttooluse-not-pretooluse.md),
deprecated and superseded by [The PostToolUse hook keeps only
conformance blocking and the generated.by check, once the language
server delivers lint and profile
findings](../decisions/plugin-posttooluse-conformance-only-after-lsp.md)).
As of LSP phase 4 the hook keeps exactly two jobs: it blocks on a `core.conformance`
diagnostic for the edited file, and it reads the written file to block a
`Write` (warn an `Edit`) of a concept with no `generated.by` when the
config sets `actors.agent`. It no longer emits `additionalContext` for
`core.lint` or profile diagnostics — the registered language server (see
[LSP](lsp.md)) now delivers those findings with precise ranges directly
in the editor (`plugin/CLAUDE.md:64-76`). `PostToolUse` still
runs `okfit validate` with `--skip-provenance`: the git-derived fallback
tier of `generated-at-drift` costs a git walk per concept, measured
taking validate from about 0.5 s to 1.7 s on this bundle, so the
edit-time hook skips that tier while CI and the MCP `validate_bundle`
tool keep it. A migrated concept (one carrying `generated.body_sha256`)
is unaffected by the flag and is still checked, cheaply, by content
comparison even at edit time — see [A body digest inside generated
detects real drift, not a rewritten
date](../decisions/profiles-body-sha256-detects-real-drift.md).
On Copilot, which honours no `PostToolUse` block, the same reason arrives as
`additionalContext` instead (`plugin/CLAUDE.md:72-74`). Kill switches: `OKFIT_HOOKS=off`
disables both; `OKFIT_SESSION_HOOK=off` and `OKFIT_VALIDATE_HOOK=off`
disable one each; comparison is exact-string `off` only
(`plugin/CLAUDE.md:47-54`).

## Distribution, MCP and LSP

Tagged but never published to npm (`plugin/CLAUDE.md:3-10`). The config
registers `mcpServers.mcp`, running `bin/start-mcp.sh`, which resolves the
consuming repo's own `node_modules/.bin/okfit-mcp` and falls back to `npx
--yes @okfit/mcp`; the build writes it into a generated `.mcp.json` (Claude
Code) rather than inline in `plugin.json`. The six tools it exposes are named
explicitly in `agents/okf-docs.md`'s `tools:` block and reach an agent as
`mcp__plugin_okfit_mcp__<tool>` on Claude Code and `mcp/<tool>` on Copilot
(`plugin/CLAUDE.md:88-97`; see `okf/interfaces/okfit-mcp.md`). Copilot gives
an MCP server no project directory, so the launchers export
`OKFIT_PROJECT_DIR` only when one is reported; on Copilot `okfit-mcp` falls
back to its working directory (the plugin root) and the launcher goes
straight to `npx`.

The config also registers `lspServers.okfit`, running `bin/start-lsp.sh
--stdio` through `sh`, for the `.md` extension (`extensionToLanguage`) with
`diagnostics: true`, written into a generated `.lsp.json`; the loader
resolves `node_modules/.bin/okfit-lsp` first and falls back to
`npx --yes @okfit/lsp`, the same shape as `bin/start-mcp.sh` -- see
[LSP](lsp.md). The server starts lazily, on the first `Edit` or `Write` of
a `.md` file in the session, and publishes diagnostics batched into the
model's context on the next `Edit` or `Write`; they are advisory only and
never block a tool call, unlike the `PostToolUse` hook above. Claude Code
runs at most one language server per file extension per session, and the
first one registered wins (`plugin/README.md:148-172`) -- another markdown
LSP plugin loaded earlier in the same session shadows this one entirely,
with no fix available while OKF bundle files remain plain `.md`. This is
Claude Code's own behaviour, not something this plugin's manifest opts into
or could opt out of.
