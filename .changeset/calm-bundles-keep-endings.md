---
"@okfit/engine": minor
---

## Features

* `SkipReason` gains `index-unparseable` and `changed-during-read`; `VerifyBatchSkipReason` gains `changed-during-read`; `MoveError`, `QueryConceptNotFoundError`, `VerifyConceptNotFoundError` and `TargetFailure` gain the reason `changed-during-read`
* `okf-version-undeclared` now names a root index that is unclosed or unparseable, instead of reporting the version as merely missing (#512)

## Bug Fixes

* `okfit sync` keeps a file's CRLF or LF line endings when it rewrites `index.md` and `log.md` (#505)
* `okfit sync` never overwrites an `index.md` it could not read (#512)
* When a file changed during the load, sync holds back the indexes and log that would list it and the changed concept's own stamp; other concepts' stamps are still written, so a bundle that lost a file to a concurrent save is never written from
* `okfit mv` and `migrate --fix` refuse when a file changed during the load
* Containment checks now judge the whole path, not only its last segment (#460)
* The sync stale check compares each target with the text the bundle load read, so an edit that lands between the load and the plan is refused with `SyncPlanStaleError` instead of overwritten
* `makeOverlayFileSystem` answers the read-only `open` and `realPath` a confined read needs, so unsaved overlay documents read the same way as files on disk
* `ConceptQuery.get`, `ConceptQuery.neighbors`, `Targets.resolve` and `okfit verify <id>` answer a concept that changed during the load with `"<path>" changed while it was read; try again` (reason `changed-during-read`) instead of "no concept"
