---
type: Decision
title: Interactive prompts are gated by audience and terminal, and the audience never refuses a command
description: okfit prompts only when the audience is human and stdin and stdout are terminals; --audience, --human, --agent, --ci and OKFIT_AUDIENCE shape output and prompting but never make a command fail.
tags:
  - architecture
  - dx
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-01T18:31:01Z
  body_sha256: 6897eb8caef48ad3b2923e0c9b2d15c22468f7f3c36bec2375a4529004f01255
---

# Interactive prompts are gated by audience and terminal, and the audience never refuses a command

## Context

Bare `okfit verify` and `okfit init` gained interactive screens (a concept
picker and a setup wizard). okfit is also run by agents, hooks and CI, where
a prompt that waits for a keypress hangs the run. `@effected/cli` 0.11.0
ships an audience model (human, agent, ci), a theme, and a terminal gate.

## Decision

- Prompt only when the run is interactive: audience human, a terminal on
  stdin and stdout, and not `--format json`. The audience comes from the
  global flags `--audience <human|agent|ci>`, `--human`, `--agent`, `--ci`,
  then `OKFIT_AUDIENCE`, then detection; more than one flag is exit `64`.
- The audience never refuses a command. It changes presentation and whether
  prompting is allowed; every command still runs under every audience.
- A command that needs an answer it cannot prompt for takes its defaults
  (`init`) or fails with a usage error naming the way out (`verify` with no
  selection: exit `64`, "run in a terminal to pick interactively").
- Cancelling a prompt (Esc, `q`, Ctrl-C, answering no) exits `130` and writes
  nothing; the picked work is written only after the last screen, in one
  all-or-nothing write.
- `ink` and `react` load lazily so a non-interactive run never imports them.

## Alternatives rejected

- Prompt whenever stdin is a TTY: an agent audience on a terminal would hang.
- Let an agent or CI audience refuse human-only commands: detection cannot
  tell a human's `! okfit …` run inside Claude Code from an agent's (both
  detect as `agent`), so refusal would lock the human out. Human-only stays
  enforced by the plugin's permission deny and agent rules, never by
  environment detection; `--human` or `OKFIT_AUDIENCE=human` restores
  prompting on a real terminal.

## Consequences

Scripts and hooks keep working unchanged. The contract is in
[CLI commands](../interfaces/cli-commands.md) and the wiring in
[CLI](../modules/cli.md); the kit adoption is in [okfit's front ends build
on @effected/{engine,cli,mcp}](front-ends-adopt-the-effected-kit.md).
