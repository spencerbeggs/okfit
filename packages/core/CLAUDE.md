# @okfit/core

The no-internal-deps base package. Owns OKF v0.3 frontmatter schemas (and reads v0.2 bundles), bundle
loading, the link graph, derivation (trust tier, staleness, index and log
rendering), and validation. Every other `@okfit/*` package depends on it.

## Rules

- No Node-only imports. Platform services (`FileSystem`, `Path`) come from
  the environment so the same code runs in a CLI, in tests with
  `@effected/memfs`, and in a GitHub Action. Time is an explicit `now`
  argument, never a `Clock` dependency (D-10).
- No opinions beyond the spec. Anything that says what a bundle *should*
  contain belongs in `@okfit/profiles` or a config file.
- Loading never fails on content. Bad files become diagnostics.

## Layout

```text
src/
  index.ts          -- public barrel; never exports from internal/
  Actor.ts (Actor, ActorPattern, Actor.matches/allowed/isPattern) Timestamp.ts Source.ts Generated.ts Verification.ts Status.ts (Status, DerivedStatus) AttestedComputation.ts
  Concept.ts (Concept, EntryPaths, Concept.entryPath: a kept entry's YAML path) ConceptId.ts Diagnostic.ts IndexDocument.ts LogDocument.ts Bundle.ts (Bundle.load, Bundle.parseDocument: the one parse every bundle file goes through; Bundle.inlineComputation: the computation under a stated reading, legacy or current) Graph.ts (Graph.fromBundle, Graph.resolve with an optional FallbackRule, Graph.replacement, LinkResolution) Derive.ts Validate.ts
  ConfinedRead.ts (ConfinementError, readConfinedBytes, readConfinedString: open, confineReal, compare the open file's dev/ino with lstat of the real path; a read is confined at the moment of reading (a file that changed under the read is `read-changed`), a write stays a check then writeAtomic; Bundle.load, sync, MCP use it)
  OkfVersion.ts (OkfVersion.parse/compare/declared/legacyFallbacks: the one declared-version gate)
  OkfitConfig.ts    -- spec 4.2 struct, DEFAULTS, merge, severityFor, read, OkfitConfigFile tag
  internal/         -- engine: position, fence, yamlPathSpan (YAML path to file span, shared by frontmatter.ts and Diagnostic.ts), frontmatter, reserved, links, lintRules, templates;
                       walk.ts is a thin adapter over @effected/walker's descend (record mode for
                       unreadable directories and the `links` it passes over), not a hand-rolled recursive walker.
                       linkScan.ts turns the walker's `links` (directory links not entered, dangling links) into symlink-escape findings: a directory link is decided by confineReal on its real path; pruned names are silent for file links and directory links alike (a pruned file link is dropped by Bundle.load, never read), hidden ones only with includeHidden
```

Tests live in `__test__/`, never in `src/`; `@effect/vitest` (`it.effect`, `assert`), never `expect`; `@effected/memfs` plus `Path.layer` for the filesystem. Fixtures under `__test__/fixtures/`, helpers under `__test__/utils/`.

## Config rules

- `OkfitConfig` is a `Schema.Struct`; every key `optionalKey` except `extensions`. Unknown top-level TOML keys go to `extensions` (a warning, never an error); config only tightens the spec.
- `merge` is pure and never mutates; arrays replace wholesale. Core owns the config JSON Schema whole: `okfitConfigDocumentFields` (the annotated struct `lib/configs/schemastore.config.ts` projects into the published document via `pnpm schema:build` / `schema:check`), `CONFIG_SCHEMA_VERSION` (its `major.minor` label — additive optional key = minor, removed/retyped key = major), `okfitConfigSchemaHost` (the hosted `$id`, whose `versions` derive from that label), and `SCHEMA_DIRECTIVE` (the `#:schema` line a config file opens with). Core also exports the `OkfitConfigFile` tag. Discovery, XDG, the layer, and `init` — which writes the directive — belong to the engine (`okf/decisions/comparable-version.md`).
- `Derive.trustTier` counts only current verification events (OKF 0.3 §5.3: `at` >= `generated.at` by instant, or `generated`/`generated.at` absent), for every bundle. `Derive.isCurrent(concept, at)` and `Derive.currentVerifications(concept)` expose the rule; earlier events stay in the file as history.
- `Derive.renderLog(groups, options?)` assembles a whole `log.md` from dated groups (`# <title>\n\n` plus each group's own `renderLogEntry`, joined by one blank line; default title `"Log"`). `init` and the forthcoming `sync` CLI command both call it instead of hand-assembling the join.
- `[bundle] non_concepts` (globs, no default in core) and the lint `non-concept-unlisted` (default `warn`, silent without the key) are the mechanism for OKF 0.3 §3.2 non-concept Markdown; which names are allowed is the profile's opinion. The lint reads the `frontmatter-missing` / `type-missing` load diagnostics and leaves them unchanged.
