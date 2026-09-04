# @okfit/cli

The `okfit` bin. Built on `effect/unstable/cli` (the command tree, flags,
help) with `@effected/cli` for output and failure rendering once commands
exist. Config loading goes through `@effected/app`.

Exit codes: 0 clean, 1 lint errors, 2 conformance errors, 3 infrastructure
failure.

## Layout

```text
src/
  bin.ts          -- #!/usr/bin/env node entry; runs rootCommand under NodeRuntime
  index.ts        -- programmatic barrel (rootCommand, CLI_VERSION)
  commands/
    root.ts       -- the `okfit` root command
```

Tests live in `__test__/`. E2E tests spawn `dist/dev/pkg/bin/okfit.js`, which
the root `vitest.setup.ts` builds before the run.
