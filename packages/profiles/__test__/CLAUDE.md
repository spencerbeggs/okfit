# Test Directory

This project uses `@vitest-agent/plugin` for test discovery. Tests live here in
`__test__/`, not co-located in `src/`.

## Directory Structure

```text
__test__/
  utils/                      # Shared helpers for unit tests, plus git.ts (see Exceptions)
    git.ts                    # Hermetic git spawn collector and temp-repository builders
  fixtures/                   # Static test data for unit tests
    history.ts                # F4 and conflict-merge replay data, shared with integration
    software-project/         # Clean bundle for the profile (zero diagnostics)
    bad/                      # One bundle per profile or lint defect
  *.test.ts                   # Unit tests: doubles only, never a spawned process

  integration/
    utils/                    # Integration-only helpers (none yet; git.ts lives above)
    fixtures/                 # Integration-only static data (none yet)
    *.int.test.ts             # Integration tests over a real temp repository

  e2e/
    utils/
    fixtures/
    *.e2e.test.ts
```

## Rules

- **Classification is by filename, not location.** `*.int.test.ts` is always
  integration regardless of which directory it sits in. Same for `*.e2e.test.ts`.
- **`utils/` and `fixtures/` are excluded from test discovery.** Put shared
  helpers and builders in `utils/`; put static data in `fixtures/`.
- **Each test category has its own `utils/` and `fixtures/`**, with the two
  exceptions below.
- **Never put test files in `src/`.** All tests belong in `__test__/`.
- **Never inline large test data in test files.** Extract it to `fixtures/`.
- **Never define shared mocks or helper functions in test files.** Extract them
  to the appropriate `utils/` directory.
- **`@effect/vitest` only:** `it.effect` plus `Effect.gen` for Effect code,
  plain `it` for pure synchronous code, `assert` for every assertion. `expect`
  is banned (P-35). Typed failures are asserted with `Effect.flip` or
  `Effect.result`; defects with `Effect.exit` and `Cause.hasDies`.
- **Unit tests never spawn a process** (P-32). They provide
  `GitHistory.layerTest(script)` and `Git.layerTest({ show, configGet, repoRoot })`
  from `@effected/git`; both DIE on an unscripted call, which is the intended
  signal that a test touched a member it did not stub.
- **Integration suites build one temp repository per `describe`** in
  `beforeAll` with `buildRepo(steps)` from `utils/git.ts`, remove it in
  `afterAll` with `removeDir`, and treat it as read-only in tests (P-33).
  They provide the real spawner with `NodeServices.layer` from
  `@effect/platform-node`; unit-classified suites may use `NodeFileSystem.layer`
  and `NodePath.layer` only to load static fixture bundles from disk (P-49).
- **Fixture git is hermetic** (P-34): `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`, `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, repo-local
  `user.name`/`user.email`, `commit.gpgsign=false`, and pinned
  `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` on every commit. Temp directories are
  `realpath`-resolved before any comparison with `Git.repoRoot`. Fixture
  failures are defects, never passes.

## Exceptions (P-36, P-50)

- `__test__/utils/git.ts` is used only by integration suites but lives in the
  unit `utils/` directory because P-36 names that path. It carries the
  fixtures' own thirty-line spawn collector; `src/internal/spawn.ts` is never
  imported by a test.
- `__test__/fixtures/history.ts` is shared by both categories on purpose: the
  unit suites script `GitHistory.layerTest` and `Git.layerTest` from
  `F4_ENTRIES`/`F4_TEXTS`, and the integration builder replays `F4_STEPS`, so
  the two suites can never disagree about the history. It imports nothing
  from `src/`.
