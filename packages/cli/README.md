# @okfit/cli

The `okfit` command line for [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 bundles: `okfit validate`, `okfit init`, `okfit context`, `okfit verify`, and `okfit sync`. The full subcommand list is `okf/interfaces/cli-commands.md`'s to keep, not this sentence's to count.

> **Part of the okfit kit.** Most users want **[@okfit/plugin](https://www.npmjs.com/package/@okfit/plugin)**, which pulls this package in automatically.

## Usage

```text
okfit [--help] [--version]
okfit validate [path] [--config <file>] [--format human|json] [--skip-provenance] [--help]
okfit init [path] [--profile <name>] [--config <file>] [--help]
okfit context [path] [--config <file>] [--format human|json] [--help]
okfit verify <id> [path] [--config <file>] [--at <iso>] [--dry-run] [--format human|json] [--help]
```

`[path]` is the **project root** on every subcommand — the directory discovery
starts from, and, for `init`, where `.config/okfit.toml` is written.
It is never the bundle root; the bundle root is `<project root>/<bundle.path>`
(`okf` by default). Default `[path]` is the current directory.

### `okfit validate`

Loads the config, loads the bundle, runs conformance and lint checks against
it, runs the resolved profile's own checks, and renders every diagnostic.

```console
$ cd my-repo && okfit validate
0 errors, 0 warnings, 0 info in 1 concepts (okf)
$ echo $?
0
```

A run that finds diagnostics prints one line per diagnostic to stdout, then
the summary to stderr:

```console
$ okfit validate --config ./ci-config.toml
warning: unknown profile "legacy-project"; continuing with defaults
(bundle) warning config-unknown-key unknown top-level key "extra_section"
modules/router.md:12:1 error required-key-missing missing required key "description"
1 errors, 1 warnings, 0 info in 4 concepts (okf)
$ echo $?
1
```

Each diagnostic line is `<file>:<line>:<col> <severity> <code> <message>`
(one-based line and column) when the diagnostic carries a range, or
`<file> <severity> <code> <message>` when it does not; a bundle-level
diagnostic (no file at all) prints `(bundle)` in place of `<file>`.
Diagnostics sort by file (so `(bundle)` leads), then range-less before
ranged, then by offset, then by code.

`--skip-provenance` skips the `generated-at-drift` lint's git tier for
this one invocation, without touching the project's `[lint]` table. That
is `Provenance.lint`'s tier 2 only — the git-derived date comparison used
for a concept stamped before `generated.body_sha256` existed. The digest
tier still runs: it compares the recorded digest against the body already
in memory, so it spawns nothing and still reports a body edited without a
re-stamp. The Claude Code plugin's PostToolUse hook passes the flag on
every edit-time `validate` call so a git spawn per concept never runs on
keystroke-level edits; CI and the MCP `validate_bundle` tool omit it and
keep both tiers.

### `okfit init`

Scaffolds a fresh OKF bundle: a thin `.config/okfit.toml`, the
bundle's root and per-directory `index.md` files, a `project.md` stub, and an
initial `log.md` entry — then self-validates the result and exits with
`validate`'s own exit code, so a scaffold that does not validate clean is a
defect.

```console
$ mkdir my-repo && cd my-repo && okfit init
Initialized okf with the software-project profile
0 errors, 0 warnings, 0 info in 1 concepts (okf)
$ echo $?
0
$ find . -type f | sort
./.config/okfit.toml
./okf/conventions/index.md
./okf/decisions/index.md
./okf/index.md
./okf/interfaces/index.md
./okf/log.md
./okf/modules/index.md
./okf/project.md
./okf/references/index.md
```

`init` never overwrites. If any target path already exists, nothing is
written:

```console
$ okfit init
error: refusing to overwrite existing files:
  .config/okfit.toml
  okf/index.md
  okf/log.md
  okf/project.md
  okf/modules/index.md
  okf/decisions/index.md
  okf/conventions/index.md
  okf/interfaces/index.md
  okf/references/index.md
Nothing was written.
$ echo $?
3
```

`init` also refuses when any of the other two project-level names --
`.okfit.toml` or `okfit.toml` -- already exists in the target directory,
and names every colliding file in one error. An ancestor directory's config
is a legitimate discovery hit, not a collision, and is never probed.

`--profile <name>` picks the profile `init` scaffolds for (default: the
config's `bundle.profile`, itself defaulting to `software-project`); an
unrecognised name is a warning, not a failure — `init` continues with the
default profile.

### `okfit context`

Prints the resolved project root, bundle root, config path, profile, and
vocabulary (`types` and `tags` from the merged config) without loading the
bundle. Useful for a script or a Claude Code hook that needs to know where
the bundle lives before deciding whether to run `okfit validate`.

```console
$ okfit context
project root: /abs/path/to/my-repo
bundle root: /abs/path/to/my-repo/okf
config: (none)
profile: software-project
index.md: /abs/path/to/my-repo/okf/index.md (exists)
agent: (unset)

types:
  Convention  A rule contributors and agents must follow.
  Decision  A choice made, the alternatives rejected, and why.
  Interface  A contract others depend on.
  Module  A unit of code with an owner and a boundary.
  Project  The repository's root concept: its purpose, boundaries, and non-goals.
  Reference  Mirrored external material kept under the references directory.

tags:
  architecture  Concerns the shape of the system rather than one module.
  performance  Concerns speed, memory, or resource cost and the trade-offs made for them.
  release  Concerns how changes ship: versioning, changelogs, publishing, and tagging.
  security  Concerns trust boundaries, secrets, permissions, or attack surface.
  testing  Concerns how the system is verified: strategy, fixtures, and coverage policy.
```

All paths `humanContext` prints are absolute, exactly as the resolved envelope carries them
(never relativized to the current directory the way `validate`'s summary line is) — the
example above reflects that, not a shortened path for readability.

`--format json` uses its own envelope, `ContextEnvelope` (schema 1),
documented in `## --format json` below — never `validate`'s `JsonEnvelope`.
There is no `--profile` flag on `context`; that one belongs to `init`
alone. Config discovery, the `--config` pre-flight, and the K-4/K-15
warnings all behave exactly as `## Config discovery` describes below.

### `okfit verify`

Appends one attestation, `{ by: human:<id>, at: <now> }`, to a concept's
`verified` list and writes the file back. `<id>` is a concept id with or
without a leading slash or trailing `.md`. The actor is always your own git
identity, resolved from `user.name`/`user.email` and `[actors].humans`;
there is no `--by`. Existing entries are never touched or replaced — every
run appends, including a repeat by the same person. `--at <iso>` records a
different instant; `--dry-run` runs the same splice and prints the exact
fragment it would write, under a `would write:` line, without touching the
file. Exit `0` on success (a dry run included), `3` on any failure.

A read-only concept is overwritten anyway — the write goes through a temp
file and an atomic rename, and the target's mode is preserved on the
replacement, but the file is not skipped just because it is `chmod`-ed
read-only.

This is a human-run command: it records **your** attestation that you
reviewed the concept, so no agent, hook, or MCP tool ever invokes it.

## Config discovery

With no `--config` flag, `okfit` walks upward from `[path]` (default:
the current directory). In each directory it checks `<dir>/.okfit.toml`,
then `<dir>/okfit.toml`, then `<dir>/.config/okfit.toml` before moving
up one level, so a child directory's `okfit.toml` always beats a
parent's `.okfit.toml`. Past the project it falls back to
`$XDG_CONFIG_HOME/okfit/config.toml` (and `$XDG_CONFIG_DIRS`), then the
OS-native config directory
(`~/Library/Application Support/okfit/config.toml` on macOS,
`%APPDATA%\okfit\config.toml` on Windows), then `/etc/okfit/config.toml`
on Linux and macOS. First match wins; nothing merges across levels, and
`okfit` never probes for a `.git` directory.

The project root anchors on the matched file's own directory -- except
for `.config/okfit.toml`, which anchors on the parent of `.config`. An
XDG, native, system-tier or absent config anchors on the current
directory instead.

Because the upward walk never stops at `$HOME`, it reaches `$HOME` itself
before falling through to the XDG tier. `~/.config/okfit.toml` and
`~/okfit.toml` are therefore **project-tier** files, not the personal
defaults they look like: the walk finds them like any other project
config, wins over the XDG tier, and anchors the project root at `$HOME`
-- so every project under `$HOME` with no config of its own resolves
against a stray `~/.config/okfit.toml`. Personal defaults belong at
`$XDG_CONFIG_HOME/okfit/config.toml` (note the extra `okfit` directory),
not directly under `~/.config/`.

`--config <file>` bypasses discovery entirely — no upward walk, no XDG probe
— and anchors the project root the same way. An explicit path inside a
`.config` directory anchors on that directory's parent, exactly as a
discovered one does. A path that does not exist is a hard failure:

```console
$ okfit validate --config ./missing.toml
error: config path not found: /abs/missing.toml
$ echo $?
3
```

A config whose `okf_version` disagrees with the version this `okfit` speaks
is a warning, not a failure; the run continues.

## Exit codes

| Code | Meaning |
| --- | --- |
| `130` | Interrupted (Ctrl-C) |
| `64` | Usage error: an unknown flag or subcommand |
| `3` | Infrastructure failure: bad `--config` path, malformed or unreadable config, unset `HOME`, unreadable bundle root, or `init`'s overwrite refusal |
| `2` | One or more conformance diagnostics of severity error |
| `1` | One or more lint or profile diagnostics of severity error |
| `0` | Otherwise |

Higher wins when several apply. Warnings and info never change the exit
code.

`okfit context` never produces `1` or `2`: it prints orientation data and
never runs conformance or lint checks.

## `--format json`

`okfit validate --format json` prints exactly one JSON document to stdout and
nothing else (no summary line, no warnings — those still go to stderr):

```json
{
 "schema": 1,
 "okfit_version": "0.1.0",
 "okf_version": "0.2",
 "root": "/abs/path/to/my-repo/okf",
 "profile": "software-project",
 "exit_code": 1,
 "summary": {
  "conformance_errors": 0,
  "lint_errors": 1,
  "lint_warnings": 1,
  "lint_info": 0,
  "profile_errors": 0,
  "concepts": 4
 },
 "diagnostics": [
  {
   "source": "core.lint",
   "file": "",
   "code": "config-unknown-key",
   "severity": "warning",
   "message": "unknown top-level key \"extra_section\""
  },
  {
   "source": "core.lint",
   "file": "modules/router.md",
   "code": "required-key-missing",
   "severity": "error",
   "message": "missing required key \"description\"",
   "range": { "offset": 87, "length": 9, "line": 11, "character": 0 }
  }
 ]
}
```

`profile` is `null` when the config sets `bundle.profile = "none"` or names a
profile `okfit` does not recognise. `range` is zero-based, exactly as
`@okfit/core` computed it, and omitted for a range-less diagnostic.

An infrastructure failure under `--format json` prints a different, smaller
envelope to stdout and exits `3`:

```json
{ "schema": 1, "okfit_version": "0.1.0", "exit_code": 3, "error": { "tag": "ConfigPathNotFoundError", "message": "config path not found: /abs/ci-config.toml" } }
```

`init` has no `--format`; it is human output only.

`okfit context --format json` prints its own envelope, distinct from the
one above:

```json
{
 "schema": 1,
 "project_root": "/abs/path/to/my-repo",
 "bundle_root": "/abs/path/to/my-repo/okf",
 "config_path": null,
 "profile": "software-project",
 "profile_requested": null,
 "index_path": "/abs/path/to/my-repo/okf/index.md",
 "index_exists": true,
 "actors": { "agent": null },
 "types": [
  { "name": "Project", "description": "The repository's root concept: its purpose, boundaries, and non-goals.", "guidance": "..." }
 ],
 "tags": [
  { "name": "architecture", "description": "Concerns the shape of the system rather than one module." }
 ]
}
```

Every field is present, even when unset (`config_path`, `profile`,
`profile_requested`, and `actors.agent` are `null`, never an omitted key) --
unlike `JsonDiagnostic`'s `range`, this envelope has no optional keys at all.

`profile_requested` is the profile name the config asked for after the
default rule, and is `null` only when no config file was found at all.
`profile` keeps its original meaning: the resolved profile's name, or
`null` when the requested name is unknown (or the config sets
`bundle.profile = "none"`). The two differ only when a config names a
profile `okfit` does not recognise — `profile` is `null` but
`profile_requested` still names what was asked for, so `okfit context
--format human` prints `profile: (none) (requested <name>, unknown)` in
that one case.

## Message conventions

Every message `okfit` prints is lowercase, starts `error:` or `warning:`,
never ends with a trailing period, and renders a path relative to the
current directory when the path is under it, absolute otherwise. Colour, when
stdout is a TTY and `NO_COLOR` is not `1`, wraps only the severity word —
never the code, the path, or the message text.

## License

[MIT](LICENSE)
