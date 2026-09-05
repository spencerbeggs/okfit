# @okfit/cli

The `okfit` command line for [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 bundles: `okfit validate` and `okfit init`.

> **Part of the okfit kit.** Most users want **[@okfit/plugin](https://www.npmjs.com/package/@okfit/plugin)**, which pulls this package in automatically.

## Usage

```text
okfit [--help] [--version]
okfit validate [path] [--config <file>] [--format human|json] [--help]
okfit init [path] [--profile <name>] [--config <file>] [--help]
```

`[path]` is the **project root** on both commands — the directory discovery
starts from, and, for `init`, where `.config/okfit/config.toml` is written.
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

### `okfit init`

Scaffolds a fresh OKF bundle: a thin `.config/okfit/config.toml`, the
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
./.config/okfit/config.toml
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
  .config/okfit/config.toml
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

`--profile <name>` picks the profile `init` scaffolds for (default: the
config's `bundle.profile`, itself defaulting to `software-project`); an
unrecognised name is a warning, not a failure — `init` continues with the
default profile.

## Config discovery

With no `--config` flag, `okfit` walks upward from `[path]` (default: the
current directory) looking first for `<dir>/.config/okfit/config.toml`, then
`<dir>/okfit.config.toml`, and falls back to
`$XDG_CONFIG_HOME/okfit/config.toml` for personal defaults shared across
projects. The project root anchors on whichever of the first two was found
(three directories up from `.config/okfit/config.toml`, or the directory of
`okfit.config.toml`); an XDG-only or absent config anchors on the current
directory instead. `okfit` never probes for a `.git` directory.

`--config <file>` bypasses discovery entirely — no upward walk, no XDG probe
— and anchors the project root the same way. A path that does not exist is a
hard failure:

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

## Message conventions

Every message `okfit` prints is lowercase, starts `error:` or `warning:`,
never ends with a trailing period, and renders a path relative to the
current directory when the path is under it, absolute otherwise. Colour, when
the terminal supports it and `NO_COLOR` is unset, wraps only the severity
word — never the code, the path, or the message text.

## License

[MIT](LICENSE)
