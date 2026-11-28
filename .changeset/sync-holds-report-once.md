---
"@okfit/engine": minor
---

## Breaking Changes

`planMigrationFixes` and `applyMigrationFixes` no longer declare `YamlParseError` in their error channel; neither could fail with it. A caller that wrote `Effect.catchTag("YamlParseError", ...)` on either now fails to compile. Remove that handler: the only error left is `PlatformError`.

## Features

* `SyncResult.clockBehind` (`now`, `latest`, `concepts`) and the optional `clock_behind` key on `SyncEnvelope` report a run that saw a `generated.at`, or a changed concept's commit date, more than the tolerance ahead of the clock (#509)
* `ResolvedProjectConfig.configPath` carries the discovered config file's path; `RunOptions.configPath` and `BundleSessionOptions.configPath` now accept `undefined` (#506)

## Bug Fixes

* `okfit sync` reports a held future stamp as `verified-after-now` on the run that holds it. A changed concept is still written, so it may now appear in both `written` and `skipped` (#509)
* A changed concept whose future stamp guards no verification dated after now is re-stamped to now on its first sync, so "commit, then run okfit sync" converges in one run (#509)
