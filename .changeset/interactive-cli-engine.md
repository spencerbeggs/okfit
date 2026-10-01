---
"@okfit/engine": minor
---

## Features

### Verify an explicit list of concepts

* `runVerifyIds` verifies a given list of concept ids all-or-nothing: if any id cannot be attested, nothing is written. An optional `promote` flag moves drafts to stable in the same write (closes #214)
* `selectPickerCandidates` and `loadPickerCandidates` expose the concepts an interactive picker can offer, with `PickerCandidate`, `PickerCandidatesOptions` and `VerifyIdsOptions` for front ends

## Other

* The `VerifySelectionError` no-selection message now ends "(run in a terminal to pick interactively)"
