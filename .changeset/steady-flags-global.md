---
"@okfit/cli": patch
---

## Bug Fixes

* `--format` on `validate`, `context`, `lint`, `stale`, `mv`, `sync`, `verify` and `query list`, `get` and `neighbors` is now a scoped global setting. Its values and defaults are unchanged, and it now appears under GLOBAL FLAGS in those commands' help.
* A usage error caught while parsing arguments under `--format json` prints the same JSON envelope with exit code 64, rendered through `@effected/cli-kit`.
* `--format json` on a command that has no `--format` flag, such as `okfit init` or the bare `okfit query` group, no longer prints a JSON envelope. `okfit graph` keeps its own `--format`.
