# @okfit/profiles

Opinionated layer over `@okfit/core`. Ships named profiles: a complete okfit
config value (types, tags, fields, lint severities) plus derivation code
(`generated.at` from git, human actor from git config). Core stays
opinion-free; everything that says what a bundle *should* contain lives here.

## Layout

```text
src/
  index.ts            -- public barrel; never exports from internal/
  Profile.ts          -- PROFILE_NAMES, ProfileName, Layout, LayoutDirectory, ProfileDiagnosticCode, ProfileDiagnostic, Profile
  SoftwareProject.ts  -- the software-project literal, layout, and check; NOT re-exported (reachable only via Profiles.softwareProject)
  Profiles.ts         -- Profiles facade: get(name), softwareProject
  GitHistory.ts       -- PathHistoryEntry, GitHistoryError, PathLogOptions, GitHistoryShape, GitHistory service (layer, makeTest, layerTest);
                         a thin adapter over `@effected/git`'s `Git.log` -- scopes the whole-repository log to one
                         path (`--follow`, `--diff-merges=first-parent`) and decodes it into `PathHistoryEntry`.
                         No `internal/` spawn modules remain: `Git.log` owns the spawn, the argv, the record
                         parsing, and the stderr classification.
  BodyProvenance.ts   -- BodyCommitted | BodyUncommitted tagged union
  Derivation.ts       -- Writer, GitIdentity, the two actor errors, Derivation facade: body, bodyDigest, generatedAt, humanActorId, generatedBy, staleAfter
                         bodyDigest is sha256 over the normalised body via effect's Crypto service (issue #19); core holds the field, never computes it
  Provenance.ts       -- Provenance facade: Provenance.lint(bundle, config, options?), the generated-at-drift lint (S-8); not a Profile member, no range (S-12)
                         Two tiers: generated.body_sha256 when recorded (pure, no git, catches a dirty body), the git date walk otherwise
```

Tests live in `__test__/`, never in `src/`; see `__test__/CLAUDE.md`.

## Rules

- Effect v4 only, at the version in `catalog:effect`. `@okfit/core`, `@effected/git`, and `@effected/markdown` are peers (Convention A); nothing under `src/` imports `@effect/platform-node` or `node:child_process` directly — `GitHistory.layer` goes through `effect/unstable/process`.
- `SoftwareProject.ts` is never re-exported from `src/index.ts`; `softwareProject` is reachable only as `Profiles.softwareProject`. Nothing under `internal/` crosses the barrel.
- `Derivation` is package-global, not per profile. It never rewrites `generated.by` on re-derivation and never substitutes `now` for an uncommitted body — both are the caller's decision.
- No `process.cwd()` and no environment reads anywhere in `src/`: `writer` and `cwd` are explicit arguments (P-16).
- Relative imports use `.js` extensions; built-ins use `node:`; type imports are separate `import type` statements; TSDoc `@public` on every export from `src/`; tab indentation.
- `Context.Service` and `Schema.TaggedError` classes (`GitHistory`, `GitHistoryError`, `HumanActorUnresolvedError`, `AgentActorUnconfiguredError`) are declared inline; `savvy.build.ts` keeps the `_base` `ae-forgotten-export` suppression rather than hand-exporting the synthesized base.
- The `README.md` TOML fence is a test fixture: `__test__/SoftwareProject.test.ts` decodes it and deep-equals it against the `software-project` literal. Change both together.
