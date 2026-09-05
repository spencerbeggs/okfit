# @okfit/core

The no-internal-deps base package. Owns OKF v0.2 frontmatter schemas, bundle
loading, the link graph, derivation (trust tier, staleness, index and log
rendering), and validation. Every other `@okfit/*` package depends on it.

## Rules

- No Node-only imports. Platform services (`FileSystem`, `Path`, clock) come
  from the environment so the same code runs in a CLI, in tests with
  `@effected/memfs`, and in a GitHub Action.
- No opinions beyond the spec. Anything that says what a bundle *should*
  contain belongs in `@okfit/profiles` or a config file.
- Loading never fails on content. Bad files become diagnostics.

## Layout

```text
src/
  index.ts          -- public barrel; never exports from internal/
  Actor.ts Timestamp.ts Source.ts Generated.ts Verification.ts Status.ts AttestedComputation.ts
  Concept.ts ConceptId.ts Diagnostic.ts IndexDocument.ts LogDocument.ts Bundle.ts Graph.ts Derive.ts Validate.ts
  OkfitConfig.ts    -- spec 4.2 struct, DEFAULTS, merge, severityFor, read, OkfitConfigFile tag
  internal/         -- engine: posixPath, position, walk, frontmatter, reserved, links, lintRules, templates
```

Tests live in `__test__/`, never in `src/`; `@effect/vitest` (`it.effect`, `assert`), never `expect`; `@effected/memfs` plus `Path.layer` for the filesystem. Fixtures under `__test__/fixtures/`, helpers under `__test__/utils/`.

## Config rules

- `OkfitConfig` is a `Schema.Struct`; every key `optionalKey` except `extensions`. Unknown top-level TOML keys go to `extensions` (a warning, never an error); config only tightens the spec.
- `merge` is pure and never mutates; arrays replace wholesale. Core exports the `OkfitConfigFile` tag only; discovery, XDG and the layer belong to the CLI.
