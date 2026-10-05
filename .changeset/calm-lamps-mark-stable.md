---
"@okfit/lsp": minor
---

## Features

- Add a "Mark verified by <actor> and set status: stable" code action on draft concepts. It records your verification and promotes the concept to stable in a single edit.
- Add the `okfit.lsp.verifyAndMarkStable` command, which takes the concept `uri` as its one argument. The new command id is included in `OKFIT_COMMANDS`.
- Add a `NotADraft` tag to `EditFailure`, returned when the combined action targets a concept whose status is not draft.
