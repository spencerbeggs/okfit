---
"@okfit/cli": patch
---

## Bug Fixes

* An `okfit verify` refusal that quotes a frontmatter value or an argument now prints it on one line, and the nothing-to-revoke refusal no longer prints its class name (#511)
* A malformed `okfit verify --at` is now a usage error with exit code 64 (it was 3) and names the expected form; it is checked before the config is read (only an explicit `--config` that does not exist is checked first, exit 3) (#513). Scripts that treated exit 3 as the signal for a bad `--at` should check for 64 instead.
* `okfit sync --since` refuses an impossible calendar date such as `2026-02-30` with exit code 64. It used to accept one and silently act as a later floor.
* `--stable` and `--draft` accept one concept named more than once (#514)
* Every `okfit verify` skip line names a next step (#517)
* The future-stamp advice says to commit any change to the body, then run `okfit sync` (#515)
* The `not tracked by git` and `has uncommitted changes` skip lines of `okfit sync` name a next step
