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
- **This package's only meaningful tests are e2e, and they run the PACKED
  tarballs (E-6).** The bug this package exists to fix (`@okfit/cli`/`@okfit/mcp`
  declared as auto-installed peer dependencies, which package managers never
  link a `node_modules/.bin` entry for) is invisible to any assertion made
  against `package.json` or the in-memory `OKFIT_BINS` constant. Only
  installing the published artifact and running the bins proves the fix, so
  `e2e/packed-install.e2e.test.ts` uses `@effected/workspaces/testing`'s
  `PackedInstall`: it packs `dist/prod/npm/pkg` for the carrier and its
  closure, installs under npm, pnpm, Yarn and bun locally (`require: "any"`
  skips a manager that is not installed) and under npm, pnpm and bun in CI
  (`require: "all"`; root `devEngines.runtime` names bun so the runner has it,
  Yarn stays local-only and its slot row is asserted only on Yarn 2+), and per consumer runs `okfit --version`, the
  `distribution` stamp, an `okfit-mcp` `McpProbe.initialize` and an
  `okfit-lsp` `LspProbe.initialize` (`@effected/lsp/testing`) through `runCarrierBin`/`carrierCommand`, plus the
  per-manager `binProvenance` table. `allowSharedBins: true` because the front
  ends share the bin names (see the shared-bins Decision).
- **The packed suite needs the PROD build.** `PackedInstall` packs
  `dist/prod/npm/pkg`; `vitest.setup.ts` builds only `dist/dev`, so the suite
  skips when `PackedInstall.preflight` + `PackedInstall.gate` find the prod
  build absent locally but FAILS under `CI` (a `describe.runIf` guard asserts
  with the gate's message), so a missing build is loud. `workspaceOverrides:
  true` hands the scratch consumers any `file:` sibling build linked in
  `pnpm-workspace.yaml` (a no-op when none is).
  Root `ci:test` runs `turbo run build:prod` before vitest. Run
  `pnpm turbo run build:prod` locally before expecting it to run.
  Its timeout comes from `PackedInstall.closure` + `timeoutBudget`, planned
  with a top-level `await` at module evaluation; the env pins `FORCE_COLOR=0`.
