---
"@okfit/cli": minor
---

## Breaking Changes

`okfit --version` now prints the carrier package at the end of the line when the bin was installed through one, instead of after the CLI version:

```text
okfit 0.15.0 (engine 0.19.0, okf 0.2, config-schema 1.0) via @okfit/plugin 0.6.0
```

A direct install is unchanged (`okfit 0.15.0 (engine 0.19.0, okf 0.2, config-schema 1.0)`). The suffix is now appended by `@effected/cli`'s `CliRuntime.main` `distribution` option, the same carrier the `--format json` envelopes report as `distribution`. A script that parsed the line by position should match `via <name> <version>` at the end, or read `distribution` from any `--format json` report instead.
