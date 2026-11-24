---
"@okfit/profiles": minor
---

## Breaking Changes

`DriftReason` gains the literal `verified-before-change`. A consumer that holds an exhaustive `Record<DriftReason, ...>` or switches over every reason must add it.

Verification integrity is now current only while its bound entry is itself current under OKF 0.3 §5.3: a binding dated before the concept's `generated.at` evaluates as drifted with reason `verified-before-change`, and its drift detail carries the editor and time of the last change. Such a concept needs `okfit verify` run again.

## Features

- `verified-drift` no longer reports the `verified-before-change` reason; the core lint of that name is its single reporter.
- `Trust.boundEntry` is now public. It returns the `integrity.verified` binding when it names the latest human entry, and ignores the `[actors].humans` allow-list and whether the entry is current.
