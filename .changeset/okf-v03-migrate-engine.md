---
"@okfit/engine": minor
---

## Features

### Migration findings and safe fixes

- `migrationFindings(bundle, config, target)` reports what in a bundle reads differently under a target OKF version. Each `MigrationFinding` carries one of five `MigrationCode`s: `okf-version-undeclared`, `okf-version-older`, `okf-version-unparsable`, `root-relative-path` and `computation-locator`. A `computation-locator` finding is reported only when the Computation section reads differently under the target: a depth-one section that is exactly one fenced block reads the same and is not reported. A finding that has a safe fix names its `MigrationFixKind` (`okf-version` or `root-relative-path`).
- `planMigrationFixes` and `applyMigrationFixes` (options `MigrationFixOptions`, result `MigrationFixPlan`) carry out the two safe fixes: declaring `okf_version`, and rooting a bare reference that resolves only from the bundle root. Every edit is planned before any file is written, so a failure while planning writes nothing. `refused` lists a fix that was not planned, with the reason, and the other fixes still apply: the version fix is refused while a root-only reference remains, and when the root index frontmatter does not parse (malformed YAML or a duplicate key), in which case no `YamlParseError` escapes and the file is left as it was. `drifts` lists each edited concept whose okfit verification integrity was current before the edit, and each edited concept whose recorded body digest could not be re-recorded. A fix that repairs a link re-records the concept's generated body digest, so `generated.at` is kept. A fix never writes a verification.

### `run` and the JSON report

- `run` accepts `target` and returns `migration`, the findings for that target (an empty list without one).
- Diagnostics have a fourth source, `"migrate"`. A migrate diagnostic never affects the exit code.
- The JSON envelope gains optional `target` and `fixes` (type `JsonFixes`: `applied`, `refused`, `drifts`, `dry_run`), and a diagnostic may carry `fix`.
- `summary.migration_findings` is a new field in JSON output. It is always present, and is `0` when no target was given. Code that validates the envelope against a closed shape must allow it.

## Bug Fixes

- `init` no longer writes root `title` and `description` into a bundle that declares OKF 0.2 or earlier, where a strict reader rejects them (#468).
