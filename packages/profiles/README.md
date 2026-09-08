# @okfit/profiles

Named configuration profiles for [okfit](https://github.com/spencerbeggs/okfit). A profile is a complete `OkfitConfig` value plus derivation rules for `generated.at` and `generated.by`. The first profile, `software-project`, describes a software repository's knowledge bundle.

> **Pre-release.** Part of the `@okfit/*` kit, in early development.

## The `software-project` profile

`Profiles.softwareProject.config` is a hand-authored `OkfitConfig` (P-25) that sets only `concepts`, `types`, `tags`, and `extensions: {}`; `okf_version`, `bundle`, `lifecycle`, `actors`, and `lint` are inherited from `OkfitConfig.DEFAULTS` by whoever merges it (the CLI applies `DEFAULTS < profile < file` with `OkfitConfig.merge`). `Profiles.get(name)` resolves a profile by its exact name and answers `Option.none` for `"none"` and unknown names. The TOML below decodes to the exact same value and is checked against the literal by `__test__/SoftwareProject.test.ts`:

```toml
[concepts]
required = ["title", "description"]
tags.required = []

[types.Project]
description = "The repository's root concept: its purpose, boundaries, and non-goals."
guidance = "Exactly one Project exists and it lives at the bundle root as the project file. State the purpose in one paragraph and list what is deliberately out of scope so a reader never infers boundaries from silence."

[types.Module]
description = "A unit of code with an owner and a boundary."
guidance = "One per workspace package, plugin, website, or action. Link to the Decisions that shaped it and the Conventions it is bound by."
required = ["resource", "kind"]

[types.Module.fields.kind]
description = "What sort of unit this is; drives which conventions apply."
values.workspace = "The monorepo root: tooling, CI, release, shared config."
values.package = "A publishable npm package under packages/."
values.website = "A docs or marketing site, usually RSPress."
values.plugin = "A Claude Code or editor plugin distributed outside npm."
values.action = "A GitHub Action."

[types.Module.fields.resource]
description = "A path relative to this concept file, normally escaping the bundle, for example ../../packages/core."
kind = "path"

[types.Decision]
description = "A choice made, the alternatives rejected, and why."
guidance = "Never edit a stable Decision; deprecate it and write a new one that names it in supersedes. A Decision counts as settled only once a human has verified it."
require_verified = true

[types.Decision.fields.supersedes]
description = "The Decision this one replaces."
kind = "path"

[types.Convention]
description = "A rule contributors and agents must follow."
guidance = "State the rule as an instruction rather than a description of current behaviour. Give it a staleness window so it is re-examined on a cadence instead of rotting silently."

[types.Interface]
description = "A contract others depend on."
guidance = "Document the contract from the consumer's side: what stays stable, not how it is built. Point resource at the file, endpoint, or schema the promise lives in."
required = ["kind"]

[types.Interface.fields.kind]
description = "What kind of contract this is."
values.api = "A programmatic library surface: exported functions, classes, and types."
values.cli = "A command-line interface: commands, flags, and exit codes."
values.config = "A configuration file schema other tools read or write."
values.wire = "A network or IPC wire format."
values.mcp = "An MCP tool or resource surface."

[types.Interface.fields.resource]
description = "A path relative to this concept file, normally escaping the bundle, for example ../../packages/core/src/index.ts."
kind = "path"

[types.Reference]
description = "Mirrored external material kept under the references directory."
guidance = "Only for material this repository must cite reliably even if the original moves. Every Reference declares where it came from in sources."
required = ["sources"]

[tags.architecture]
description = "Concerns the shape of the system rather than one module."

[tags.testing]
description = "Concerns how the system is verified: strategy, fixtures, and coverage policy."

[tags.release]
description = "Concerns how changes ship: versioning, changelogs, publishing, and tagging."

[tags.security]
description = "Concerns trust boundaries, secrets, permissions, or attack surface."

[tags.performance]
description = "Concerns speed, memory, or resource cost and the trade-offs made for them."
```

Only `concepts`, `types`, and `tags` carry real vocabulary; the literal's `extensions: {}` is `OkfitConfig`'s one required key and never appears on disk, since the codec folds unknown top-level keys into it (P-24: `fields.<k>.kind = "path"` and the `tags` table are vocabulary only — core enforces none of it yet). `Reference.required = ["sources"]` checks presence only: `sources = []` passes, and each entry's shape is core's `family-invalid` (P-23).

`Profiles.softwareProject.check(bundle)` additionally enforces, outside `OkfitConfig` entirely, that exactly one `Project` concept exists and lives at the bundle root (P-21): zero `Project`s is `project-missing`, more than one is `project-multiple` (one diagnostic per `Project` concept), and a `Project` whose path contains `/` is `project-not-at-root`. All three are severity `error` and are not configurable.

## Layout

`Profiles.softwareProject.layout` is scaffolding data for `okfit init`, never part of `OkfitConfig` (P-26):

```text
root:
  index.md      -- bundle index
  log.md        -- bundle log
  project.md    -- the one Project concept, at the bundle root

directories:
  modules/       -> Module
  decisions/     -> Decision
  conventions/   -> Convention
  interfaces/    -> Interface
  references/    -> Reference
```

Each directory carries its own `index.md`. What `okfit init` writes into these files is the CLI plan's concern, not this package's.

## Derivation

`Derivation` is package-global, not per profile:

- **`generated.at` is the author date, not the stamp date (P-4).** Walking a path's git history newest-first, the commit that changed the body is the one whose blob first differs from its predecessor's; that commit's *author* date (`%aI`) is `generated.at`. Its committer date, author name, and author email are carried on the result for callers that want a history-based policy later, but `generated.at` itself is never the date of a later frontmatter-only stamp.
- **The path log is `@effected/git`'s `Git.log(cwd, { paths: [path], follow: true, firstParentDiffMerges: true })` (P-5, amended P-46, decision 56).** `firstParentDiffMerges` surfaces a conflict-resolving merge whose blob differs from both parents (probed on git 2.54.0), which plain `--follow` can omit and which would otherwise attribute that body change to the wrong commit. `Git.log`'s unconditional `-z` makes `--name-only` emit paths raw — no C-style quoting — so no `core.quotePath` override is needed and a path containing a space, a quote, or a newline round-trips verbatim. The dirty check compares the worktree body against `Git.show(root, "HEAD", path)`, never against the newest log entry. `--follow`'s rename detection can itself stop at a commit that renames a file and rewrites its content enough that git no longer treats it as a continuation of the same history; when that happens, `generated.at` answers that rename commit rather than an older one.
- **Uncommitted is the caller's to interpret (P-10).** `Derivation.generatedAt` reports `{ _tag: "uncommitted", reason: "untracked" | "dirty" | "unborn" }` and never substitutes `now`. The recommended policy, followed by the snippet below: omit `generated.at` entirely until the body is committed.
- **Human actor resolution (P-13).** Given git identity `{ name?, email? }` and `config.actors.humans`, the first hit wins: (1) a `human:<id>` entry whose id matches the email's local part or the name's slug, case-insensitively (config spelling returned); (2) `human:<local part>`; (3) `human:<slug of name>`; (4) unresolved. The slug lowercases `name`, replaces runs of whitespace and characters outside `[A-Za-z0-9._-]` with `-`, and trims leading and trailing `-`.
- **Identity is read at merged config scope (P-15).** `Derivation.generatedBy` calls `Git.configGet(cwd, "user.name")` and `Git.configGet(cwd, "user.email")` with no `scope` option. Environment overrides (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `EMAIL`, `user.useConfigOnly`) are out of scope for phase 1.
- **`stale_after` is pure addition (P-19).** `Derivation.staleAfter(from, config)` is `from + (config.lifecycle?.default_stale_after ?? OkfitConfig.DEFAULTS.lifecycle.default_stale_after)`, falling back to 90 days. `from` should be `generated.at` when the provenance is `committed`, otherwise the caller's own `now`; re-stamp whenever `generated.at` changes.

Recommended stamping policy, followed end to end:

```ts
const by = yield* Derivation.generatedBy({ writer, cwd: path.dirname(file), config }); // P-16; agent needs actors.agent (P-17)
const provenance = yield* Derivation.generatedAt({ file, config });                    // P-2, P-9, P-39
const at = provenance._tag === "committed" ? Option.some(provenance.at) : Option.none(); // omit `at` until committed (P-10)
const staleAfter = Derivation.staleAfter(Option.getOrElse(at, () => now), config);       // P-19; `now` is the caller's
// serialisation is the CLI's: Schema.encodeSync(Timestamp) writes "...T08:00:00Z" after the P-18 core patch (P-41)
```

Frontmatter serialisation, the uncommitted policy's enforcement, `now`, layer composition (`Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(NodeServices.layer))`), exit codes, and everything `okfit init` writes belong to the CLI plan, not this package (P-30, P-41, P-44).

## Provenance

`Provenance.lint(bundle, config)` is the `generated-at-drift` lint
(`lint.generated_at_drift`, config default `"info"`): it walks
`Derivation.generatedAt` once per concept with a `generated` block, and
reports a core `Diagnostic` when a committed body's `generated.at` is
missing or does not match the derived instant (compared as decoded
`DateTime.Utc` values, never encoded strings). It is silent for an
uncommitted body, for a concept with no `generated` block, and returns `[]`
the moment it discovers the bundle is outside a git repository at all. It
emits no `range` — the message carries both instants and a 7-character
sha, which is what a reader acts on. It is a plain facade over
`Derivation`, not a `Profile` member: `severityFor`, the `[lint]` table,
the renderers, the PostToolUse hook, and the MCP `validate_bundle` tool all
treat its `Diagnostic`s like every other lint. The CLI (`okfit validate`,
`okfit sync`'s own reporting) is the only caller and the only place the
`"off"` severity actually skips the git walk; this package's own function
always reads `config` but never gates on it.

## License

[MIT](LICENSE)
