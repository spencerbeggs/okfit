---
type: Module
title: CLI
description: The okfit command line -- validate, init, context, verify, query, and sync, built on effect/cli and @effected/cli, with audience flags and interactive prompts.
status: stable
resource: ../../packages/cli
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-01T18:31:01Z
  body_sha256: 094132d83968012136942bfa46dbe01370e60f614c7261f7c8213e5a9a611d61
---

# CLI

## Purpose

`@okfit/cli` is the `okfit` bin: `okfit validate`, `okfit init`,
`okfit context`, `okfit verify`, `okfit query`, and `okfit sync`; built on
`effect/cli` for the command tree, flags, and help, and
`@effected/cli`'s `CliRuntime.main`/`CliTheme`/`CliExit` for assembly,
failure rendering, colour, and exit codes. It
is a presentation shell over [Engine](engine.md): config discovery and the
validate/verify/sync/init/context programs live in `@okfit/engine`, not
here (`packages/cli/CLAUDE.md:1-8`). The distribution comes from
`@effected/engine`'s `CurrentDistribution` reference; `Distribution`
itself is re-exported from `@effected/engine` too -- see [okfit's front
ends build on @effected/{engine,cli,mcp} rather than hand-rolled
equivalents](../decisions/front-ends-adopt-the-effected-kit.md). `okfit context` prints the same
orientation data (project root, bundle root, config path, profile,
vocabulary) without loading the bundle -- cheap enough for a Claude Code
hook to call on every session and every in-bundle write. `verify` also
takes `--all` and `--type <Type>` (repeatable) to attest a whole selection
at once instead of one id at a time (and `--stable`/`--draft` to set `status` in the same write as the attestation), `query list|get|neighbors` renders the engine's `ConceptQuery` results as a human table or a `Query*Envelope`, and `sync` also takes `--since
<YYYY-MM-DD>` (widens the log floor) and `--staged` (the pre-commit
shape: stamps only the git index with `now` and re-adds what it writes)
-- see [Engine](engine.md) for what each does; this package only threads
the flags through.

## Audience and interactive prompts

Every subcommand takes the global audience flags `--audience
<human|agent|ci>` and the shorthands `--human`, `--agent`, `--ci`;
`OKFIT_AUDIENCE` is the environment fallback (flag, then env var, then
detection), and giving more than one flag is exit `64`.
`CliRuntime.main`'s `env: { audienceEnvVar: "OKFIT_AUDIENCE" }` wires the
audience, `CliTheme` and the interactive-terminal gate, and `main.ts` runs
the root command through `CliAudience.run`. The audience shapes presentation
and decides whether prompting is allowed; it never refuses a command.
Interactivity is the audience being human with a terminal on stdin and
stdout, and not `--format json`.

Two commands prompt, only when interactive: bare `okfit verify` opens a
picker (`commands/verify-picker.ts`: a MultiSelect by type, then a Confirm
with a promote-drafts toggle, then one all-or-nothing `runVerifyIds` in
[Engine](engine.md)), and `okfit init` runs a wizard
(`internal/initWizard.ts`) for whichever of profile, `--bundle <dir>` and
`--config-location` was not given as a flag. Cancelling (Esc, `q`, Ctrl-C,
answering no) is the kit's `Cancelled`, exit `130`, nothing written;
`renderFailure` prints the kit's `Cancelled` and `NotInteractive` messages
as they are, with no `error:` prefix. `ink` and `react` are `@okfit/cli`
dependencies loaded lazily, so a non-interactive run never imports them.
Contract details: [CLI commands](../interfaces/cli-commands.md).

## Config discovery and exit codes

Config loading has two branches, chosen once per invocation, never one
chain with a conditional resolver list (K-10/K-57), assembled in
[Engine](engine.md)'s `config/layer.ts#buildConfigLayer` as ONE
`AppConfig.layer(OkfitConfigFile, ...)` call varying only the chain
options: `--config <file>` given -- the path is statted first, then the
layer carries only `resolvers: [ConfigResolver.explicitPath(path)]` and
`xdg: false`, no upward walk, no XDG probe. No `--config` -- the layer
carries `resolvers: [ConfigResolver.upwardWalk({ filenames: [".okfit.toml",
"okfit.toml", ".config/okfit.toml"], name: "project" })]` and
`systemEtc: true`, landing personal defaults at
`$XDG_CONFIG_HOME/okfit/config.toml` (`xdg`/`native` stay on their
defaults) and system defaults at `/etc/okfit/config.toml`. A
`ConfigCodecError`/`ConfigValidationError` from either branch is wrapped
into `ConfigMalformedError` naming the failing path. Exit codes: `0`
clean, `1` lint/profile errors, `2` conformance errors, `3` infrastructure
failure, `64` usage error, `130` interrupt (`packages/cli/CLAUDE.md`).

## Process and dependency boundaries

`process` is read only in `bin.ts`, `main.ts`, every file under
`commands/`, and `version.ts`
(`CLI_VERSION`, one of the three numbers `okfit --version` prints beside
`ENGINE_VERSION` and `OKF_SPEC_VERSION`; `main(options?)` accepts the
`distribution` the meta-package's bin shim passes through — see [The
engine version, not the producer version, is what a report is compared
on](../decisions/engine-version-is-the-comparable-version-effected-kit.md)).
`internal/tty.ts`, this package's former sole reader of `isTTY`/
`NO_COLOR`, and `internal/exit.ts` (`setExitCode`) are deleted: colour is
now `@effected/cli`'s `CliTheme` decision, read through the ambient
`ConfigProvider` rather than `process`, and exit codes go through
`CliExit.set` -- a **user-visible change**: `NO_COLOR` used to disable colour
only when it was exactly `1`; now any non-empty value does, the
no-color.org rule.
Everything under `render/` is pure or Effect-typed with no `process`
access and no `@effect/platform-node` import (`packages/cli/CLAUDE.md`,
K-9/K-49). This package no longer imports `@effected/app` at all -- config
discovery moved to [Engine](engine.md), enforced as a blanket
`{ forbidImports: ["@effected/app"] }` `SourceBoundary` rule (from
`@effected/workspaces/testing`), broader than a three-name
(`App`/`AppStore`/`AppCache`) allowlist. `package.json`'s `dependencies`
block is the full runtime closure this package's own code, plus core's and
profiles' peers, need -- not a list to "clean up" for apparently-unused
entries (`packages/cli/CLAUDE.md`, K-35). `@okfit/engine` declares no
`peerDependencies` of its own, so nothing here satisfies one on engine's
behalf.
