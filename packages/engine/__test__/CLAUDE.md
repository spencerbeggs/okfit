# Test Directory

This project uses `@vitest-agent/plugin` for test discovery. Tests live here in
`__test__/`, not co-located in `src/`.

## Directory Structure

```text
__test__/
  config/              # config/anchor.ts, config/layer.ts, config/resolve.ts
  context/             # context/run.ts
  init/                # init/scaffold.ts
  render/              # render/{context,exit,json,sort,sync}.ts (context.ts and sync.ts
                        # cover only the envelope halves this package owns)
  sync/                # sync/{generated,index,log,write}.ts, sync/run.ts
  validate/            # validate/run.ts
  verify/              # verify/{locate,splice}.ts
  utils/               # Shared mocks, helpers, and type utilities
  fixtures/            # Static test data and fixture files
  *.test.ts            # Package-level tests (boundaries.test.ts, errors.test.ts,
                        # platform.test.ts, smoke.test.ts)
```

There is no `e2e/` or `integration/` tier here: `@okfit/engine` exposes a
library barrel, never a bin, so its own tests never spawn a child process.
End-to-end coverage of the assembled program lives in `@okfit/cli`'s and
`@okfit/mcp`'s own `__test__/e2e` suites, against the real built bins.

## Rules

- **Classification is by filename, not location.** A `*.test.ts` file is a
  unit test regardless of which subdirectory it sits in; there is no
  `*.e2e.test.ts`/`*.int.test.ts` suffix in this package.
- **`utils/` and `fixtures/` are excluded from test discovery.** Put shared
  mocks, test helpers, builder functions, and type utilities in `utils/`. Put
  static data (fixture bundles, sample config files) in `fixtures/`.
- **Never put test files in `src/`.** All tests belong in `__test__/`.
- **Never inline large test data in test files.** Extract it to `fixtures/`.
- **Never define shared mocks or helper functions in test files.** Extract
  them to `utils/` so other tests can reuse them.
- **`@effect/vitest` throughout; `expect` is banned (K-42).** Use `it`,
  `it.effect`, `describe`, and `assert` from `@effect/vitest`, never `expect`
  from plain `vitest`.
- **`boundaries.test.ts` carries NO allowlist.** Unlike `@okfit/cli`'s copy
  of the same scanner, which excuses `bin.ts`, `commands/*`, and a handful
  of other files, this package's version fails on any file under
  `engine/src` that reads `process`, with no exception. Do not add one --
  a `process` read belongs in a front end, never in the shared engine.
