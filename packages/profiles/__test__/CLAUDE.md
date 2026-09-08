# Test Directory

This project uses `@vitest-agent/plugin` for test discovery. Tests live here in
`__test__/`, not co-located in `src/`.

## Directory Structure

```text
__test__/
  utils/
    git.ts                        # fixture repository builder; runCollected now delegates to @effected/commands' Run.collect (P-34, P-36)
    derivation.ts                 # identityGit, world, windowsPath doubles and the HistoryCommit decoders
  fixtures/
    history.ts                    # F4 (c1..c5, topic, c6) and conflict-merge (m1..m4) replay steps, encoded entries, blob texts
    pathLogOutput.ts              # shas/dates/paths for the GitHistory.makeTest/layerTest doubles (the parser fixtures it used to feed are gone)
    software-project/             # clean bundle: zero conformance and lint diagnostics under the merged profile config
    bad/                          # module-no-kind, module-kind-unknown, decision-unverified, reference-no-sources,
                                  # interface-no-kind, two-projects, project-in-subdir, no-project,
                                  # reference-empty-sources, project-multiple-nested
  index.test.ts                   # PROFILE_NAMES, Profiles.get, barrel inventory
  Profile.test.ts                 # ProfileDiagnosticCode/ProfileDiagnostic decode and reject, renderer shape
  SoftwareProject.test.ts         # round-trip, README TOML fence, type table, layout/types, guidance style guards
  SoftwareProject.check.test.ts   # Profiles.softwareProject.check over the fixture bundles
  GitHistory.test.ts              # make() over Git.makeTest overrides (flags, error mapping, empty-paths drop), makeTest/layerTest doubles, GitHistoryError.message
  Derivation.test.ts              # body, generatedAt, humanActorId, generatedBy, staleAfter over doubles

  integration/
    history.int.test.ts           # smoke test: the replayed F4 and conflict-merge repositories
    GitHistory.int.test.ts        # live GitHistory.layer over temp repositories
    Derivation.int.test.ts        # end-to-end Derivation over the same temp repositories
```

## Rules

- **Classification is by filename, not location.** `*.int.test.ts` is always
  integration regardless of which directory it sits in. Everything else is a
  unit test.
- **`utils/` and `fixtures/` are excluded from test discovery.** Put shared
  helpers in `utils/` and static data in `fixtures/`.
- **`__test__/utils/git.ts` is shared by the integration suites.** This is a
  recorded exception to the per-category `utils/` rule (P-36, Addendum item
  50, closed 2026-09-07): `src/internal/spawn.ts` is gone (`GitHistory` no
  longer spawns anything itself — it delegates to `@effected/git`'s `Git.log`),
  so `runCollected` here now calls `@effected/commands`' `Run.collect`
  directly rather than duplicating a hand-rolled collector. Do not move it
  under `integration/utils/`.
- **`__test__/fixtures/history.ts` is shared by both categories on purpose**
  (P-50): the unit suites script `GitHistory.layerTest` and `Git.layerTest`
  from `F4_ENTRIES`/`F4_TEXTS` through `utils/derivation.ts`, and the
  integration builder replays `F4_STEPS`, so the two can never disagree about
  the history. It imports nothing from `src/`.
- **Unit tests never spawn a process (P-32).** They provide
  `GitHistory.layerTest(...)` and `@effected/git`'s `Git.layerTest(...)`;
  both DIE on an unscripted call, so a missing stub is a defect, not a pass.
  Only `integration/*.int.test.ts` runs real `git`.
- **Integration repositories are hermetic (P-33, P-34).** One temp repository
  per `describe`, built in `beforeAll` and removed in `afterAll`, read-only in
  tests; every git command runs with `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`, `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, repo-local
  `user.name`/`user.email`, `commit.gpgsign=false`, and pinned
  `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`; temp directories are
  `realpath`-resolved before comparison with `Git.repoRoot`.
- **The hermetic envelope now covers the system under test too (decision
  57, amends P-34).** `../vitest.setup.ts` sets `GIT_CONFIG_GLOBAL=/dev/null`
  and `GIT_CONFIG_NOSYSTEM=1` on `process.env` for this package's whole
  Vitest project before any test file runs, so `GitHistory.layer` and
  `@effected/git`'s `Git.layer` — which inherit the ambient environment,
  unlike the fixture builder's own explicit per-call env — never read the
  host's `~/.gitconfig` or a machine-wide system config either. Picked up
  automatically by `@vitest-agent/plugin`'s `DefaultDiscoverStrategy` as a
  package-root `vitest.setup.ts`; not under `src/` (P-16 is about
  `src/`'s own reads, not the test harness).
- **`@effect/platform-node` is test-only (P-29).** Integration suites provide
  `Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(NodeServices.layer))`;
  `SoftwareProject.check.test.ts` loads the static fixture bundles with
  `NodeFileSystem.layer` + `NodePath.layer`.
- **`@effect/vitest` only.** `it`, `it.effect`, `assert`; `expect` is banned
  (P-35, D-37).
- **Never put test files in `src/`.** All tests belong in `__test__/`.
- **Never inline large test data in test files.** Extract it to `fixtures/`.
- **Never define shared mocks or helper functions in test files.** Extract them
  to `utils/` so other tests can reuse them.
