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

The `software-project` profile (`bundle.profile`'s default) sets six types
and five tags on top of `OkfitConfig.DEFAULTS`, plus
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

Each type's full `guidance` string is longer than is worth reproducing here;
read it from the merged config (`okfit context --format json`) or
`packages/profiles/README.md` rather than trusting a paraphrase.

Tags: `architecture`, `testing`, `release`, `security`, `performance` --
each a one-sentence `description`, no `guidance`.

Two details that surprise:

- `Module` requires `resource` and `kind` -- most types have no `required`
  list at all.
- `Decision` sets `require_verified = true` -- a Decision is not settled
  until a human verifies it. That is exactly the field `okf-authoring`'s
  rule 2 forbids the agent from writing.

The profile also carries a `layout` (`root.{index,log,project}` plus five
directories: `modules/`, `decisions/`, `conventions/`, `interfaces/`,
`references/`) that `okfit init` scaffolds from. That layout is **not** part
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

## A worked example

Load `references/example-config.toml` when: writing a config from scratch.
The smallest useful edit is just naming the profile and the agent:

```toml
[bundle]
profile = "software-project"

[actors]
agent = "okfit/claude-code"
```
