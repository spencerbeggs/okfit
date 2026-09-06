---
type: Interface
title: Claude Code plugin hooks contract
description: The two Claude Code plugin hooks (SessionStart, PostToolUse), their kill switches, and the CLI resolution order both share.
kind: config
resource: ../../plugins/claude-code/hooks/hooks.json
status: stable
generated:
  by: human:spencer
tags:
  - architecture
---

# Claude Code plugin hooks contract

## Two hooks

`SessionStart` (`hooks/session-start/orientation.sh`, no matcher — every
source, `startup`/`resume`/`clear`/`compact`, re-orients) and `PostToolUse`
(`hooks/post-tool-use/validate.sh`, matcher `Write|Edit`)
(`plugins/claude-code/README.md:65,76-77`,
`plugins/claude-code/CLAUDE.md:79-80`).

## SessionStart contract

Calls `okfit context --format json` once, never `okfit validate` — loading
the whole bundle just to learn where it is would be wasteful. Turns the
result into `additionalContext`: bundle root and profile, the full
vocabulary, the bundle's `index.md` contents (truncated at 12,000 bytes),
and a nudge when `actors.agent` is unset. With no config at all it still
shows the default profile's vocabulary plus a note that `okfit init` would
scaffold one (`plugins/claude-code/README.md:65-74`,
`plugins/claude-code/CLAUDE.md:71-77`).

## PostToolUse contract

The write has already landed by the time this hook runs, so it is a
stop-and-fix signal, never a prevention. For a path under the bundle root,
it runs `okfit validate --format json` on the whole bundle, filters the
diagnostics to the edited file, turns a `core.conformance` hit into
`{"decision": "block", ...}`, and turns a `core.lint` hit into a
non-blocking warning. A path outside the bundle root never reaches `okfit
validate` at all (`plugins/claude-code/README.md:76-87`,
`plugins/claude-code/CLAUDE.md:79-86`).

## Kill switches and CLI resolution

`OKFIT_HOOKS=off` disables both hooks; `OKFIT_SESSION_HOOK=off` and
`OKFIT_VALIDATE_HOOK=off` disable one each, comparison exact-string `off`
only. Both hooks resolve the CLI the same way: `$OKFIT_CLI_CMD` →
`<project>/node_modules/.bin/okfit` → `okfit` on `PATH`. If none resolves,
the session hook prints a nudge and the validate hook allows the write
silently; neither hook ever runs `npx` or exits non-zero
(`plugins/claude-code/README.md:89-99`,
`plugins/claude-code/CLAUDE.md:62-69`).

## MCP loader status

`bin/start-mcp.sh` ships and is tested, but `plugin.json` registers no
`mcpServers` block yet — `@okfit/mcp`'s stub always exits `1`, so wiring it
in now would make "not installed" and "installed but stubbed" produce the
identical failure. It lands once `@okfit/mcp` implements the protocol
(`plugins/claude-code/README.md:101-109`,
`plugins/claude-code/CLAUDE.md:88-92`).
