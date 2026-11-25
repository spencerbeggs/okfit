# @okfit/cli

The `okfit` command line for [Open Knowledge Format (OKF)](https://github.com/open-knowledge-format/open-knowledge-format/blob/main/SPEC.md) v0.3 bundles: `okfit validate`, `okfit init`, `okfit context`, `okfit verify`, `okfit query`, `okfit mv`, and `okfit sync`. The full subcommand list is `okf/interfaces/cli-commands.md`'s to keep, not this sentence's to count.

> **Part of the okfit kit.** Most users want **[@okfit/plugin](https://www.npmjs.com/package/@okfit/plugin)**, which pulls this package in automatically.

## Usage

```text
okfit [--help] [--version]
okfit validate [targets...] [--root <dir>] [--config <file>] [--format human|json] [--skip-provenance] [--document <bundle-path>] [--target 0.3 [--fix [--only okf-version|root-relative-path]... [--dry-run]]] [--help]
okfit lint [targets...] [--root <dir>] [--config <file>] [--format human|json] [--skip-provenance] [--help]
okfit init [--root <dir>] [--profile <name>] [--bundle <dir>] [--config-location <name>] [--config <file>] [--help]
okfit context [--root <dir>] [--trust] [--config <file>] [--format human|json] [--help]
okfit verify [<target>...] [--root <dir>] [--all] [--type <Type>]... [--stable|--draft] [--revoke] [--no-diff] [--config <file>] [--at <iso>] [--dry-run] [--format human|json] [--help]
okfit query list [--root <dir>] [--type <Type>]... [--tag <tag>]... [--status draft|stable|deprecated]... [--verified|--unverified] [--drifted] [--stale] [--config <file>] [--format human|json]
okfit query get <targets...> [--root <dir>] [--config <file>] [--format human|json]
okfit query neighbors <id> [--root <dir>] [--config <file>] [--format human|json]
okfit sync [--root <dir>] [--config <file>] [--only generated|index|log]... [--since <ref>] [--staged] [--publication <id>] [--dry-run] [--yes] [--format human|json] [--help]
okfit mv <from> <to> [--root <dir>] [--config <file>] [--dry-run] [--format human|json]
```

`okfit --version` prints `okfit <cli> (engine <engine>, okf <okf>,
config-schema <schema>)` — for example `okfit 0.5.4 (engine 0.6.0, okf 0.3,
config-schema 1.0)`, or `okfit 0.5.4 (engine 0.6.0, okf 0.3, config-schema
1.0) via @okfit/plugin 0.3.7` when installed through the meta-package. The
engine, OKF, and config-schema versions decide what a report says and what
a config may contain; the CLI version is packaging.

`--root <dir>` is the **project root** on every subcommand — the directory discovery
starts from, and, for `init`, where `.config/okfit.toml` is written.
It is never the bundle root; the bundle root is `<project root>/<bundle.path>`
(`okf` by default). Default `--root` is the current directory. It replaced the
`[path]` positional, so positionals are concept targets everywhere.

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
for a concept stamped before `x-okfit-integrity.generated.body` existed. The digest
tier still runs: it compares the recorded digest against the body already
in memory, so it spawns nothing and still reports a body edited without a
re-stamp. The Claude Code plugin's PostToolUse hook passes the flag on
every edit-time `validate` call so a git spawn per concept never runs on
keystroke-level edits; CI and the MCP `validate_bundle` tool omit it and
keep both tiers.

`--document <bundle-path>` validates one unsaved document: its text is
read from stdin and stands in for that file (bundle-relative, posix, a
`.md` path; a file not yet written under an existing directory is walked
like any other), and nothing is written. A path that is absolute, escapes
the bundle, is not `.md`, or sits under a directory that does not exist,
and a terminal stdin, are usage errors (exit `64`). The MCP
`validate_bundle` tool's `documents` input is the same overlay.

`--target 0.3` reports, as `migrate` diagnostics with ranges, everything in
the bundle that reads differently under OKF 0.3: an undeclared, older or
unparsable `okf_version`, references that resolve only from the bundle root, in any Markdown file of
the bundle (`root-relative-path`) and a Computation section read by a different rule
(`computation-locator`). Only `"0.3"`, the version this okfit implements, is
accepted; any other value is a usage error (exit `64`). The findings print in
the normal per-file list, stderr ends with `OKF 0.3: <n> finding(s), <k>
fixable with --fix`, and they never change the exit code; the human counts
line leaves them out and `summary.migration_findings` carries the count.

`--fix` (requires `--target`; refused with `--document`) writes the two safe
fixes: it declares `okf_version` and roots a reference that resolves only from
the bundle root (`/path`). `--only okf-version` or `--only root-relative-path`
(repeatable; requires `--fix`) narrows by kind, positional targets narrow by
file, and `--dry-run` (requires `--fix`) writes nothing. The version fix is
refused while any root-only reference remains unfixed, while any
Attested Computation would have no computation under 0.3 (a `warning`
`computation-locator`), and while a Markdown file has unclosed or unparseable
frontmatter, so its links could not be checked (one `refused:` line per cause), and a concept still
using okfit's old key names is refused until `okfit sync` renames them. Output opens with
`Fixed <n> finding(s) in <m> file(s)` (`Would fix` under `--dry-run`), a
`refused: <file>: <reason>` line per refused fix, and `Integrity drifted
(re-verify with okfit verify): <ids>` when a fix changed content whose human
verification was current; then the diagnostics that remain, from a reload.
The exit code is the exit code of what remains.

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

If the repository lints markdown, the bundle needs two exemptions from
markdownlint's defaults, and neither can be satisfied at the source: MD025
(one top-level heading) counts a concept's frontmatter `title:` as its H1,
so the body H1 the spec requires reads as a second one, and the spec shapes
every `index.md` as `# Section` groups, one H1 per concept type. `log.md`
is fine: `init` and `sync` both start it with `# Log`. Add this to a
`.markdownlint-cli2.jsonc` at the repository root, adjusting the bundle
path if `bundle.path` is not `okf`:

```jsonc
"overrides": [
 {
  "combine": "merge",
  "config": { "MD025": { "front_matter_title": "" } },
  "filter": ["okf/**/*.md", "!okf/**/index.md"]
 },
 {
  "combine": "merge",
  "config": { "MD025": false },
  "filter": ["okf/**/index.md"]
 }
]
```

A repository whose lint config cannot express overrides can drop a nested
`okf/.markdownlint-cli2.jsonc` carrying `{ "config": { "MD025": false } }`
instead; the bundle loader ignores non-markdown files.

`--profile <name>` picks the profile `init` scaffolds for (default: the
config's `bundle.profile`, itself defaulting to `software-project`); an
unrecognised name is a warning, not a failure — `init` continues with the
default profile.

`--bundle <dir>` sets the bundle directory, relative to the project root
(default: the config's `bundle.path`, itself defaulting to `okf`). It is
written to the config's `bundle.path` and is where the scaffold goes. An
empty, absolute, or root-escaping value (`..`) is a usage error (exit `64`).

`--config-location <.config/okfit.toml|okfit.toml|.okfit.toml>` sets where
the config file is written (default `.config/okfit.toml`); all three are
locations discovery already reads.

When the run is interactive, `init` asks for each of the profile, the bundle
directory, and the config location that was not given as a flag, in that
order, with the default pre-selected. Esc or Ctrl-C at any prompt exits `130`
with `cancelled; nothing written`; every prompt happens before the first
write. Piped or scripted runs never prompt and behave exactly as before.

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

`okfit context --trust` also loads the bundle and adds a trust summary:
how many concepts are drifted (edited since a human verified them), stale
(past `stale_after`) or without a current verification (tier `unverified`), plus the first five drifted and
stale ids, sorted. In human output it is a `trust:` line; in JSON it is the
`trust` object (`concepts`, `drifted`, `stale`, `unverified`, `drifted_ids`,
`stale_ids`). Without the flag `context` never loads the bundle and `trust`
is `null`. The Claude Code session-start hook passes `--trust`.

All paths `humanContext` prints are absolute, exactly as the resolved envelope carries them
(never relativized to the current directory the way `validate`'s summary line is) — the
example above reflects that, not a shortened path for readability.

`--format json` uses its own envelope, `ContextEnvelope` (schema 1),
documented in `## --format json` below — never `validate`'s `JsonEnvelope`.
There is no `--profile` flag on `context`; that one belongs to `init`
alone. Config discovery, the `--config` pre-flight, and the K-4
warning all behave exactly as `## Config discovery` describes below.

### `okfit verify`

Appends one attestation, `{ by: human:<id>, at: <now> }`, to a concept's
`verified` list and writes the file back. It also binds the attestation in
`x-okfit-integrity.verified` (`{ by, at, content }`), where `content` is a 16-hex
digest of the body plus the authored frontmatter. A later edit to the concept
reports as the `verified-drift` lint (default `warn`): a signal that a human
should look again, not a gate. A verification also stops counting when the
concept changes after it: under OKF 0.3 §5.3 only a `verified` entry whose
`at` is equal to or later than `generated.at` is current, and the
`verified-before-change` lint (default `warn`) reports a concept whose trust
tier dropped for that reason. The two lints do not overlap: `verified-drift`
does not repeat a before-change verification. `<id>` is a concept id with or
without a leading slash or trailing `.md`. The actor is always your own git
identity, resolved from `git config okfit.actor` first, then `[actors].humans`,
`user.email` and `user.name`; there is no `--by`. When `[actors].humans` is non-empty it is
an allow-list (exact ids or `*`/`?` globs, case-insensitive): an unlisted
identity fails with `HumanActorNotAllowedError` (exit `3`), and so does
`--revoke`. Existing entries are never touched or replaced — every
run appends, including a repeat by the same person. `--at <iso>` records a
different instant. okfit refuses (exit `3`, with `--dry-run` too) a verification
whose instant, `--at` or now, is earlier than the concept's `generated.at`, so a
`generated.at` in the future also refuses; an instant equal to `generated.at`
is accepted. `--dry-run` runs the same splice and prints the exact
fragment it would write, under a `would write:` line, without touching the
file. Exit `0` on success (a dry run included), `3` on any failure.

The write goes through a temp file and an atomic rename, and the target's
mode is preserved on the replacement. A concept without write permission is
refused and left untouched, exiting `3`.

`verify` also refuses, exiting `3`, a concept that still carries the old
`integrity` block from an older okfit and says to run `okfit sync` first. The
editor's verify action does the same.

`--stable` or `--draft` sets the concept's `status` in the same write as the
attestation, so settling a reviewed draft is one command:
`okfit verify <id> --stable`. Passing both is a usage error (exit `64`), as
is passing either with `--all` or `--type`: promotion is a per-concept
decision. A concept already at the requested status gets no status edit. The
human line ends `; status <from> -> <to>`, `; status already <to>` or
`; status (absent) -> <to>`, and a dry run adds a `would set status:` line
with the exact fragment.

Verifying a concept that has drifted since its last verification first
prints the git diff since that verification, then asks to confirm; answering
no writes nothing. `--no-diff` skips the diff. Without a terminal the confirm
cannot be asked, so the verification proceeds as it always did.

`okfit verify --revoke <id>` removes the current actor's own `verified`
entries and clears the `x-okfit-integrity.verified` binding when that actor held it.
It never touches another person's entries. Exit `3` when the actor has
nothing to revoke on that concept; passing `--revoke` with `--all`, `--type`,
`--stable` or `--draft` is a usage error (exit `64`).

`--all` and `--type <Type>` (repeatable) attest in batch: every concept whose
type sets `require_verified`, plus every drifted concept of any type (or, with
`--type`, only the named types) whose verification by you is not already held.
A verification is held when your entry is the latest human entry and is bound
(`x-okfit-integrity.verified`), you pass `[actors].humans`, the entry is current under
OKF 0.3 §5.3, and the binding covers the current content (okfit's own integrity
rule); one made before the concept's last change is not, so the concept is
selected again. A batch skips a
concept and reports why: `draft`, `deprecated`, `unknown-status` or
`already-verified`. A batch never re-attests a
`deprecated` concept; verifying one by id is still allowed.

Bare `okfit verify` in a terminal opens a picker: every concept of a
`require_verified` type whose verification by you is not held (see above), plus every drifted concept of
any type, drafts included and deprecated and unknown-status excluded, grouped by type (↑/↓ move, space toggles, `a` toggles a
section, Enter continues). A confirm step follows, with a "promote K drafts
to stable" toggle that is on by default. The picked concepts are attested in
one all-or-nothing write. When a candidate is drifted, the picker shows a
two-pane screen that previews its diff since the last verification (or why
there is no baseline to diff against). Esc, `q`, Ctrl-C or answering no exits `130` with
nothing written. Without a terminal (a pipe, an agent or CI audience, or
`--format json`) bare `verify` is a usage error (exit `64`).

This is a human-run command: it records **your** attestation that you
reviewed the concept, so no agent, hook, or MCP tool ever invokes it.

### `okfit query`

Read-only lookups over the bundle, backed by the engine's `ConceptQuery`
layer (the same one the MCP `list_concepts`, `get_concept` and
`concept_neighbors` tools use). Bare `okfit query` prints help.

- `okfit query list [--root <dir>]` lists concepts as summaries (id, type, title,
  description, status, tags, path, tier, integrity, stale). Filters: `--type <Type>` and
  `--tag <tag>` (repeatable, each must be declared in the config),
  `--status draft|stable|deprecated` (repeatable), `--verified` (a human's
  verification is current), `--unverified` (no current verification, tier `unverified`), `--drifted`
  (edited since a human verified it) and `--stale` (`stale_after` passed).
  Each line reads `id  status  trust  type  title`, where `trust` is
  `drifted` or the concept's trust tier, followed by `,stale` when stale.
- `okfit query get <id> [--root <dir>]` prints one concept: the summary fields, plus
  `tier:`, `integrity:` (`current`, `none`, or `drifted (<reason>[; edited by
  X at T])`) and `stale:` lines, and its outgoing links. `--format json` also
  includes the raw frontmatter.
- `okfit query neighbors <id> [--root <dir>]` prints a concept's outgoing and
  incoming links.

Exit `0` on success, `3` for an unknown id, `64` for an undeclared type or
tag or for `--verified` together with `--unverified`.

### `okfit sync`

A bundle written by an older okfit keeps its old key names until `okfit sync`
runs: `integrity` is now `x-okfit-integrity`, and each `software-project` field
is now `x-okfit-<field>` (`links_to` is `x-okfit-links-to`). Until then okfit does not see the old
block, so earlier verifications report as no longer current (`verified-drift`),
and a `software-project` bundle also reports `required-key-missing` errors for
the prefixed fields. One plain `okfit sync` renames the keys in
place and reports the ids as `migrated`.

`okfit sync --staged` (the pre-commit hook) only migrates the concepts being
committed, so run a plain `okfit sync` once to move the whole bundle. A concept
sync cannot stamp (uncommitted edits, untracked, no `generated` block) still has
its keys renamed and is reported as both migrated and skipped. On a `--staged`
run, a rename that is the only write to a concept restages the whole file, so
the first commit that touches an unmigrated concept also commits any unstaged
edits to it. Run a plain `okfit sync` once and commit the key move on its own
before other work. A project whose own config names a built-in field by its bare
name, in a `[types.<T>.fields.<k>]` table or in that type's `required` list, keeps
`<k>` unrenamed for that type: update that config by hand, then run `okfit sync`
to rename the key.

Sync skips a concept and renames nothing in two cases: `legacy-key-conflict`
(it holds both the old and the new spelling of a key; remove one by hand and run
sync again) and `legacy-key-unsupported` (sync cannot rename the key in that
shape; rename it by hand).

After the move, concepts that carry a profile field and were verified show
`verified-drift`, and a human re-runs `okfit verify` on them. Renaming
`integrity` alone does not affect any verification.

### `okfit mv`

`okfit mv <from> <to>` moves a concept to a new path inside the bundle and
rewrites every reference to it (body links, path fields, `x-okfit-supersedes`,
Publication `x-okfit-renders`), keeping each reference's spelling. `<to>` is an id or a
path; `.md` is added when missing. `--dry-run` prints the plan and writes
nothing. Every file whose text changes drifts and needs a human to re-verify
it; run `okfit sync` afterwards. Refusals (destination exists, outside the
bundle, a reserved file, an unlocatable link) are exit `64` with nothing
written.

## Config discovery

With no `--config` flag, `okfit` walks upward from `--root` (default:
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

A config's `okf_version` is only what `okfit init` and `okfit sync` write into a
bundle-root `index.md` that declares none. The bundle's own declaration decides
how it is read, and `--format json` reports it (`null` when the bundle declares none).

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
 "okfit_version": "0.5.4",
 "engine_version": "0.6.0",
 "producer": "okfit",
 "distribution": null,
 "okf_version": "0.3",
 "root": "/abs/path/to/my-repo/okf",
 "profile": "software-project",
 "exit_code": 1,
 "summary": {
  "conformance_errors": 0,
  "lint_errors": 1,
  "lint_warnings": 1,
  "lint_info": 0,
  "profile_errors": 0,
  "migration_findings": 0,
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

With `--target 0.3` the envelope also carries `target` and each `migrate`
diagnostic may carry `fix` (`okf-version` or `root-relative-path`); with
`--fix` it adds `fixes` (the engine's `JsonFixes`): `{ applied: [{ path, fixes }],
refused: [{ file, code, reason }], drifts: [id], dry_run }`.

`engine_version` and `okf_version` are the pair to compare across reports:
the MCP server's `validate_bundle` tool returns this same envelope with the
same two values over one bundle, and differs only in `okfit_version` (its own
version) and `producer` (`@okfit/mcp`). `distribution` names the
meta-package the bin was installed through (`{ "name": "@okfit/plugin",
"version": "0.3.7" }`) and is `null` for a direct install. `profile` is
`null` when the config sets `bundle.profile = "none"` or names a profile
`okfit` does not recognise. `range` is zero-based, exactly as
`@okfit/core` computed it, and omitted for a range-less diagnostic.

An infrastructure failure under `--format json` prints a different, smaller
envelope to stdout and exits `3`:

```json
{ "schema": 1, "okfit_version": "0.5.4", "engine_version": "0.6.0", "distribution": null, "exit_code": 3, "error": { "tag": "ConfigPathNotFoundError", "message": "config path not found: /abs/ci-config.toml" } }
```

`init` has no `--format`; it is human output only.

`okfit verify --format json` prints `VerifyEnvelope` (`schema`, `okfit_version`,
`engine_version`, `distribution`, `id`, `path`, `verified`, `status`,
`dry_run`, `exit_code`, and `prior_integrity` when the concept was drifted and the diff was shown), where `status` is `{ "from": ..., "to": ... }` when
`--stable` or `--draft` was given and `null` otherwise. With `--all` or
`--type` it prints `VerifyBatchEnvelope`, whose `skipped[].reason` is one of
`draft`, `deprecated`, `unknown-status` or `already-verified`.
With `--revoke` it prints a revoke envelope carrying `removed` (how many of the
actor's entries were removed), `binding_cleared` (whether `x-okfit-integrity.verified`
was cleared) and `revoked_by` (the actor).

`okfit query list --format json` prints `QueryListEnvelope` (`total`, `items`);
`query get` prints `QueryGetEnvelope` (`concept`: the summary fields plus
`frontmatter` and `links`, and a `drift` object (`reason`, `edited_by`,
`edited_at`) or `null`); every summary carries `tier`, `integrity` and
`stale`; `query neighbors` prints `QueryNeighborsEnvelope`
(`id`, `outgoing`, `incoming`). Each carries `schema`, `okfit_version`,
`engine_version` and `distribution`.

`okfit context --format json` prints its own envelope, distinct from the
one above:

```json
{
 "schema": 1,
 "config_schema_version": "1.0",
 "cli_version": "0.17.0",
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
 ],
 "trust": null
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
current directory when the path is under it, absolute otherwise. Colour,
when stdout is a TTY and `NO_COLOR` is unset or empty (the
[no-color.org](https://no-color.org) rule: any non-empty `NO_COLOR` value
disables colour), wraps only the severity word — never the code, the
path, or the message text.

## License

[MIT](LICENSE)
