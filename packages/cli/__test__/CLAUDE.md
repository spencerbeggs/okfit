# Test Directory

This project uses `@vitest-agent/plugin` for test discovery. Tests live here in
`__test__/`, not co-located in `src/`.

## Directory Structure

```text
__test__/
  utils/              # Shared mocks, helpers, and type utilities for unit tests
  fixtures/           # Static test data and fixture files for unit tests
  *.test.ts           # Unit tests

  e2e/
    utils/            # Shared mocks, helpers, and type utilities for e2e tests
    fixtures/         # Static test data and fixture files for e2e tests
    *.e2e.test.ts     # End-to-end tests

  integration/
    utils/            # Shared mocks, helpers, and type utilities for integration tests
    fixtures/         # Static test data and fixture files for integration tests
    *.int.test.ts     # Integration tests
```

## Rules

- **Classification is by filename, not location.** `*.e2e.test.ts` is always
  e2e regardless of which directory it sits in. Same for `*.int.test.ts`.
- **`utils/` and `fixtures/` are excluded from test discovery.** Put shared
  mocks, test helpers, builder functions, and type utilities in `utils/`. Put
  static data (JSON, fixtures, sample files) in `fixtures/`.
- **Each test category has its own `utils/` and `fixtures/`.** Unit test
  helpers go in `__test__/utils/`, e2e helpers go in `__test__/e2e/utils/`,
  etc. Do not share helpers across categories — their setup needs differ.
- **Never put test files in `src/`.** All tests belong in `__test__/`.
- **Never inline large test data in test files.** Extract it to `fixtures/`.
- **Never define shared mocks or helper functions in test files.** Extract them
  to the appropriate `utils/` directory so other tests can reuse them.
- **`@effect/vitest` throughout; `expect` is banned (K-42).** Use `it`,
  `it.effect`, `describe`, and `assert` from `@effect/vitest`, never `expect`
  from plain `vitest`. "Snapshot" anywhere in the design spec means
  capture-and-check: `assert` on an exact string, `assert.deepStrictEqual` on
  parsed JSON, an exact numeric exit code — never a fuzzy or approximate
  comparison.
- **Fixture-copy exception (K-44).** This package owns no fixture bundles of
  its own. Every e2e test that needs a bundle on disk copies one at test time
  from `packages/core/__test__/fixtures/okf/*` (`acme_retail`,
  `crypto_bitcoin`, `ga4`, `stackoverflow`), `packages/core/__test__/fixtures/{bad,lint,config}`,
  or `packages/profiles/__test__/fixtures/*`, resolved by absolute path from
  `import.meta.dirname` and copied through `e2e/utils/fixtures.ts`'s
  `copyFixtureInto`. Never run `okfit validate`/`okfit init` directly against
  a fixture source tree — `init` writes files, and a stray write would
  corrupt the shared fixture for every other package's tests.
- **`OKFIT_NOW` is a test hook, not user-facing (K-47).** `bin.ts` reads it as
  an ISO-8601 timestamp and uses it in place of the wall clock for the whole
  command tree. Set it in an e2e test's `env` (through `e2e/utils/okfit.ts`'s
  `runOkfit`) whenever a test asserts on a `stale`-diagnostic or a `log.md`
  date; never document it outside this file.
- **E2E always spawns the built bin.** `dist/dev/pkg/bin/okfit.js`, built by
  the root `vitest.setup.ts`'s `globalSetup` before any test file runs
  (`pnpm turbo run build:dev`). `e2e/utils/okfit.ts`'s `BIN` resolves that
  path from `import.meta.dirname`; no e2e test hand-builds the path itself.
- **E2E is hermetic.** Every e2e test that touches config discovery or XDG
  paths uses `e2e/utils/fixtures.ts`'s `makeSandbox()` for a fresh `HOME`,
  `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, and
  passes that sandbox's `env` to `runOkfit` — never the host's own
  environment, and never `extendEnv`.
