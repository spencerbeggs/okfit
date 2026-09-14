---
name: okf-config
description: >-
  The okfit config file: discovery order, the three project-local locations
  and the XDG fallback, the TOML schema table by table, lint severities, and
  what the software-project profile contributes. Use when writing or editing
  .okfit.toml, okfit.toml or .config/okfit.toml, or explaining why a type,
  tag, or lint severity behaves the way it does. Trigger phrases -- "add a new
  type to the config", "change a lint severity", "where does okfit look for
  its config", "what does software-project add", "set actors.agent".
allowed-tools: Read, Grep
---

# okf-config

## Discovery order and the three file locations

With no `--config` flag, `okfit` walks upward from `[path]` (default: the
current directory), checking each directory for `<dir>/.okfit.toml`, then
`<dir>/okfit.toml`, then `<dir>/.config/okfit.toml` before moving up one
level -- so a child directory's `okfit.toml` always beats a parent's
`.okfit.toml`. Past the project it falls back to
`$XDG_CONFIG_HOME/okfit/config.toml`, then the OS-native config directory,
then `/etc/okfit/config.toml` on Linux and macOS. First match wins; nothing
merges across levels.
`--config <file>` bypasses all of it: no upward walk, no XDG probe happens
once it is given.

The upward walk never stops at `$HOME`, so `~/.config/okfit.toml` and
`~/okfit.toml` are project-tier files that shadow the XDG tier and anchor
the project root at `$HOME` -- personal defaults belong at
`$XDG_CONFIG_HOME/okfit/config.toml` instead.

`okfit init` scaffolds `.config/okfit.toml` with a `#:schema` directive
pointing at the published JSON Schema (`schemas/config/okfit-1.0.0.json`
in this repo), so a Tombi- or taplo-aware editor gets completion and
validation on the file without any further setup.

## The TOML schema, table by table

- `okf_version` -- a string. `DEFAULTS` sets `"0.2"`.
- `[bundle]` -- `path` (default `"okf"`), `profile` (default
  `"software-project"`).
- `[concepts]` -- `required` (array of frontmatter keys every concept must
  carry) and `tags.required` (array of tags every concept must carry).
- `[lifecycle]` -- `default_stale_after`, a `StaleAfterDuration`: either
  `^(\d+)(h|d|w)$` or Effect's `"<n> <unit>"` form. `DEFAULTS` is 90 days.
  This shorthand is a *config* value only: a concept's own `stale_after`
  frontmatter is an absolute ISO 8601 instant with an explicit offset, and
  `stale_after: 90d` on a concept fails `family-invalid`.
- `[actors]` -- `agent` (a branded `Actor`) and `humans` (an array of
  `Actor`). `DEFAULTS` sets only `humans: []`, so `actors.agent` is absent
  unless a config or profile sets it.
- `[lint]` -- one `LintLevel` (`off | info | warn | error`) per lint code,
  snake_case keys. The D-34 default table, reproduced verbatim:

  | Key | Default |
  | --- | --- |
  | `broken_links` | `warn` |
  | `missing_index` | `warn` |
  | `unknown_type` | `error` |
  | `required_key_missing` | `error` |
  | `field_value_unknown` | `error` |
  | `require_verified_unmet` | `error` |
  | `family_invalid` | `error` |
  | `generated_at_drift` | `warn` |
  | `computation_runtime_missing` | `error` |
  | `footnote_source_unknown` | `warn` |
  | `footnote_undefined` | `warn` |
  | `log_frontmatter` | `warn` |
  | `actor_prefix_unknown` | `info` |
  | `legacy_timestamp` | `info` |
  | `config_unknown_key` | `warn` |
  | `stale` | `info` |
  | `walk_unreadable` | `warn` |

  One extra fact worth stating: `unknown_type` is forced `off` when the
  merged config declares no types at all.
- `[types.<Name>]` -- `description?`, `guidance?`, `required?: string[]`,
  `require_verified?: boolean`, and a `fields.<key>` sub-map (each field is
  `{description, values?, kind?: "path"}`).
- `[tags.<name>]` -- `description?` only. Unlike a type, a tag has no
  `guidance` key at all -- the asymmetry is deliberate, not an oversight.
- `extensions` -- unknown top-level keys are preserved verbatim rather than
  erroring; `config_unknown_key` warns about them.
- Merge order is `DEFAULTS < profile < file`, applied by the CLI, never by
  core. Plain objects deep-merge key-wise; arrays and scalars in the
  override replace wholesale -- a config's `concepts.required` replaces the
  profile's list rather than appending to it.

## What software-project contributes

The `software-project` profile (`bundle.profile`'s default) sets sixteen
types and thirteen tags on top of `OkfitConfig.DEFAULTS`, plus
`concepts.required = ["title", "description"]`.

Types, one sentence each:

- `Project` -- "The repository's root concept: its purpose, boundaries, and
  non-goals."
- `Module` -- "A unit of code with an owner and a boundary."
- `Decision` -- "A choice made, the alternatives rejected, and why."
- `Convention` -- "A rule contributors and agents must follow."
- `Interface` -- "A contract others depend on."
- `Reference` -- "Mirrored external material kept under the references
  directory."
- `Runbook` -- "A repeatable operational procedure with a trigger and an
  observable end state."
- `Glossary` -- "A term this repository uses in its own sense, one term per
  concept."
- `Limitation` -- "A known edge of a contract: something that does not
  work, and why that is acceptable."
- `DataModel` -- "An internal source-of-truth structure that other
  artifacts are derived from."
- `Gotcha` -- "A state or result that looks like one thing and is the
  opposite: breakage that is transient, or success that did nothing."
- `Consumer` -- "An external application that consumes this repository and
  thereby scopes it."
- `Roadmap` -- "A gate and the forward-looking work behind it, held as
  intent rather than as a Decision."
- `Measurement` -- "A dated empirical result: what was measured, how, and
  what the numbers ruled in or out."
- `Invariant` -- "A property the code holds by construction: enforced by
  the type system or pinned by a test, not followed by people."
- `Incident` -- "A dated production failure: what shipped broken, what it
  looked like to the consumer, the root cause, and the guard that now
  stops it."

Choosing between the near neighbours: a Limitation is "this cannot do X";
a Gotcha is "this looks broken (or looks fine) and is the opposite". A
Runbook is followed in order and has no staleness cadence; a Convention is
a rule re-examined on one. A DataModel is documented from the maintainer's
side (what breaks if an entry is wrong); an Interface from the consumer's.
A Glossary term earns a concept on a collision or a trap, not merely
because a word is used. A Roadmap is queued work behind a gate, not a
choice made: a draft Decision that decides nothing is a Roadmap. A
Measurement is the evidence a Decision cites, kept out of the Decision's
body so it can rot on its own `stale_after`. A Consumer is a downstream
repository, not a Module of this one. An Invariant is held by a brand, a
union, or a pinned test and nobody "follows" it; a Convention is a rule a
contributor could ignore. An Incident is one dated narrative -- what
shipped broken, how it looked, the root cause, the guard -- where a Gotcha
is only the misleading signal and a Decision only the guard; write the
Incident and link the other two if they exist. A known bug nobody is
scheduled to fix is a Gotcha with a `stale_after`, not a Roadmap; it
becomes a Roadmap once the fix is planned. A Gotcha whose signal comes
from outside the repository (a GitHub platform behaviour, a consumer's
bundler) omits `resource` and names the outside system in the body rather
than pointing `resource` at a directory that merely sits nearby.

Each type's full `guidance` string is longer than is worth reproducing here;
read it from the merged config (`okfit context --format json`, which also
lists each type's `required` keys, `require_verified`, and declared
`fields` with their enum values) or `packages/profiles/README.md` rather
than trusting a paraphrase.

Tags: `architecture`, `testing`, `release`, `security`, `performance`,
`dx`, `ci`, `compat`, `bundle`, `observability`, `deps`, `github`, `docs`
-- each a one-sentence `description`, no `guidance`. `bundle` is install
weight and reachability (tree-shaking, subpath entrypoints, edges declined
for their cost) where `performance` is runtime cost; `observability` is
how the system reports on itself; `deps` is how third-party dependencies
are declared, pinned, and distributed; `github` is the GitHub platform
surface (the APIs, Apps and tokens, Actions, Packages, check runs, pull
request conventions) where `ci` is the unattended path wherever it runs;
`docs` is the documentation itself (provenance, rot, re-derivation, what
would falsify a claim) where `dx` is tooling.

Framework tags are deliberately not in the profile. A concern that names
one framework -- Effect layer memoisation, React hook ordering, Django
migrations -- is a fact about the repository, not about the
software-project shape, so a repo that keeps hitting one declares it
locally as a plain tag with a one-sentence description:

```toml
[tags.effect]
description = "Concerns an Effect v4 idiom: layers, services, error channels, or the test runner."
```

Name it after the framework, not `framework:<name>` (a colon in a tag is
legal but reads as a namespace the profile does not define). A migration
that finds the same framework idiom recurring across three or more
concepts should add the tag then, not tag by hand afterwards.

Details that surprise:

- `Module` requires `resource` and `kind` (`workspace | package | website |
  plugin | action | worker | harness | config-dependency`; `worker` is a
  detached sidecar or worker bundle another module spawns, with its own
  lifecycle, that is not itself a package or action); `DataModel` requires
  `resource`; `Interface` requires `kind` (`api | cli | config | wire | mcp
  | runtime`); `Consumer` requires `repository` (free text, a URL or an
  owner/name pair, since it lives outside this repository); `Incident`
  requires `occurred` (free text, an ISO 8601 date -- core has no date
  field kind) -- the other types have no `required` list at all.
- `Module` also declares two optional structured fields: `layer` (free
  text, the repository's own layering label such as `L2`) and `pins` (the
  sibling Module paths this one is exact-version-pinned with). `Roadmap`
  declares an optional free-text `gate`; `Measurement` an optional
  path-kind `justifies` (the Decisions it supports). `Invariant` declares
  an optional path-kind `resource` (the type or test that enforces it);
  `Incident` an optional path-kind `guard` (what now stops the failure).
- `Decision` sets `require_verified = true` -- a Decision is not settled
  until a human verifies it. That is exactly the field `okf-authoring`'s
  rule 2 forbids the agent from writing. A Decision with `status: draft`
  is exempt from `require-verified-unmet`, so a freshly authored bundle
  can validate clean before anyone has run `okfit verify`.

The profile also carries a `layout` (`root.{index,log,project}` plus fifteen
directories: `modules/`, `decisions/`, `conventions/`, `interfaces/`,
`references/`, `runbooks/`, `glossary/`, `limitations/`, `models/`,
`gotchas/`, `consumers/`, `roadmaps/`, `measurements/`, `invariants/`,
`incidents/`) that `okfit init` scaffolds from. That layout is **not** part
of `OkfitConfig` itself -- it never appears in a config file.

## actors.agent must be set for this plugin's agent

`actors.agent = "okfit/claude-code"` must be present in the repository's
config for `okf-docs` to have an actor identity to stamp `generated.by`
with. Nothing in this plugin writes that key: the profile states the reason
as doctrine -- "`actors.agent` is deliberately unset (P-17): which agent
writes is a fact about the repository, not about the software-project
shape." The
session hook nudges when it is null; a human or a skill-guided edit sets
it.

## Linting the bundle with markdownlint

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

Do not reach for a nested `okf/.markdownlint-cli2.jsonc` as a shortcut.
markdownlint-cli2 does not merge a nested file's `config` block into the
root's; it replaces it wholesale. A one-line nested file carrying only
`{ "config": { "MD025": false } }` therefore re-enables every rule the root
turned off -- in a Silk repository the `changeset-*` custom rules, disabled
at the root, fire CSH001/CSH002 on every concept. If the root config
genuinely cannot express `overrides`, the nested file must restate the
whole root `config` block with `MD025` off; the bundle loader ignores
non-markdown files, so the nested file itself is harmless to okfit.

## A worked example

Load `references/example-config.toml` when: writing a config from scratch.
The smallest useful edit is just naming the profile and the agent:

```toml
[bundle]
profile = "software-project"

[actors]
agent = "okfit/claude-code"
```
