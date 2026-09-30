---
"@okfit/cli": minor
---

## Features

### Settle a draft in one command

`okfit verify <id> --stable` (or `--draft`) sets the concept's `status` in the same write as the attestation. Passing both flags, or either with `--all` or `--type`, exits `64`. A concept already at the target status gets no status edit, and the output and JSON envelope report the change as `status: { from, to }`.

### okfit query

* `okfit query list` filters concepts by `--type`, `--tag`, `--status` and `--verified`/`--unverified`
* `okfit query get <id>` prints one concept with its frontmatter and links
* `okfit query neighbors <id>` prints a concept's outgoing and incoming links
* Each takes `--format json` and exits `3` for an unknown id and `64` for an undeclared type or tag

## Bug Fixes

* `okfit verify --all` and `--type` skip `deprecated` concepts instead of re-attesting them, reporting the reason `deprecated`, closing #143 and #185
