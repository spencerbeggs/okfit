---
"@okfit/cli": minor
---

## Features

### `okfit validate --target 0.3`

`okfit validate --target 0.3` reports what in a bundle reads differently under OKF 0.3, and `--fix` applies the safe fixes: declaring `okf_version`, and rooting a bare reference that resolves only from the bundle root.

```bash
okfit validate --target 0.3                    # report findings
okfit validate --target 0.3 --fix --dry-run    # show what would change
okfit validate --target 0.3 --fix              # apply, then report what remains
okfit validate --target 0.3 --fix --only root-relative-path docs/
```

- `--target` accepts only `0.3`.
- `--fix` requires `--target` and cannot be combined with `--document`.
- `--only okf-version|root-relative-path` (repeatable) narrows the fixes by kind and requires `--fix`.
- `--dry-run` writes nothing and requires `--fix`.
- Positional targets narrow both the report and the fixes.
- A refused flag combination exits with code 64 (and prints the error envelope under `--format json`).
- Findings never change the exit code. The human output adds a line such as `OKF 0.3: 4 finding(s), 3 fixable with --fix`, and migration findings are left out of the error, warning and info counts.
- Fixes are all or nothing. A fix that cannot be applied safely is listed as refused with its reason, and a concept whose human verification no longer covers its content is listed so you can re-verify it with `okfit verify`.
- With `--format json`, the report gains `target`, `fixes` and a `fix` field on fixable diagnostics, and `summary.migration_findings` is a new always-present count (`0` without a target).

## Bug Fixes

- `okfit init` no longer writes root `title` and `description` into a bundle that declares OKF 0.2 or earlier (#468).
