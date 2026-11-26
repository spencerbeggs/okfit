---
"@okfit/engine": minor
---

## Features

* `SkipReason` gains `index-unparseable` and `changed-during-read`; `VerifyBatchSkipReason` gains `changed-during-read`; `MoveError` gains the reason `changed-during-read`
* `okf-version-undeclared` now names a root index that is unclosed or unparseable, instead of reporting the version as merely missing (#512)

## Bug Fixes

* `okfit sync` keeps a file's CRLF or LF line endings when it rewrites `index.md` and `log.md` (#505)
* `okfit sync` never overwrites an `index.md` it could not read (#512)
* Sync holds back index, log and generated writes when a file changed during the load, so it never writes from a bundle that lost a file to a concurrent save
* `okfit mv` and `migrate --fix` refuse when a file changed during the load
* Containment checks now judge the whole path, not only its leading segment (#458)
