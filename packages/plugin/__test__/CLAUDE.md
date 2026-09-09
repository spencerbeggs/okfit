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
- **This package's only meaningful tests are e2e, and they run the BUILT
  bins (E-6).** The bug this package exists to fix (`@okfit/cli`/`@okfit/mcp`
  declared as auto-installed peer dependencies, which package managers never
  link a `node_modules/.bin` entry for) is invisible to any assertion made
  against `package.json` or the in-memory `OKFIT_BINS` constant -- the
  manifest can say the right thing while the install still yields neither
  bin. Only spawning `dist/dev/pkg/bin/okfit.js` and
  `dist/dev/pkg/bin/okfit-mcp.js` and observing them actually run proves the
  fix, so `e2e/bins.e2e.test.ts` is the regression coverage: `okfit
  --version` and an `okfit-mcp` JSON-RPC `initialize` handshake, each against
  the real built artifact. This follows `3d70770`'s rule -- stop asserting
  manifest versions in vitest -- applied to the bin-wiring case: a test that
  can only restate the fix from the same source the fix lives in is worse
  than no test.
