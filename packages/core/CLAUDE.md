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
  index.ts    -- public barrel
```

Tests live in `__test__/`, never in `src/`.
