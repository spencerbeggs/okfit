---
"@okfit/engine": minor
---

## Features

* `VerifySelectionError` gains the public reasons `at-malformed` (an `--at` that is not a timestamp) and `status-needs-one-concept` (`--stable` or `--draft` with targets that resolve to more than one concept). A consumer that matches `reason` exhaustively must add both.

## Bug Fixes

* The message of the `future` `VerifyNotCurrentError` now says the stamp is more than 5 minutes later than now and to run `okfit sync`, which re-stamps it to now (commit any edits to it first)
* `syncGenerated` now reports `generated-missing` before the uncommitted or untracked skip for a changed concept that has no generated block and no `actors.agent`, so the author is told the real blocker first (#515)
