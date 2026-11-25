---
"@okfit/cli": minor
---

## Features

- `okfit verify --at` with a time more than 5 minutes later than now is a usage error (exit `64`), also under `--dry-run`. It is refused before a picker opens or anything is written.
- A `skipped` line for a concept that is not current or has an unknown status now names what to do next.
- The pickers print one `left out` line per concept, with the next step, instead of one line listing them all.
- `okfit verify` with several targets skips a concept with an unknown status and verifies the rest. It used to fail the whole list.
- `okfit validate --target 0.3 --fix` prints one line per changed file naming its fixes, also under `--dry-run`.
- New export `notCurrentReason`.

## Bug Fixes

- `okfit mv` keeps a UTF-8 byte-order mark. It also re-records a body digest that matched before the move, so the next `okfit sync` keeps `generated.at`.
- The `okfit mv` help text and drift line no longer say that every rewritten file needs a human to re-verify it.
