---
"@okfit/cli": minor
---

## Features

- Send a usage error's help to stderr beside the parse errors, so stdout stays empty for the plugin hooks that parse it as JSON. An explicit `--help` and a bare command group still print help on stdout.
- Skip the `okfit init` profile screen when only one profile is registered; the wizard uses it without asking.

## Bug Fixes

- Stop colouring a redirected stderr: `okfit ... 2>err.log` no longer writes colour escapes into the file when stdout is a terminal.
- Render a defect (a bug, not a failure the caller caused) as the error plus a `Please report at` issue link, and a typed failure as one line.

## Breaking Changes

- `renderFailure` now takes the kit's `FailureDetails` as a required second argument, `renderFailure(error, details)`.
