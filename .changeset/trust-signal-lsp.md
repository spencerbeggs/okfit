---
"@okfit/lsp": minor
---

## Breaking Changes

* The public `EditTarget` loses `verifiedBy`; it now carries `verified: { by, at }[]`.
* `EditTarget.binding` gains a required `at`.
* The lsp `ConceptSummary` gains required `tier` and `integrity` fields.

## Features

* Hover shows an integrity line when hovering a link to a concept
* Inlay hints append ` · drifted` to a verified concept whose content changed
* The `okfit/concepts` request returns each concept's `tier` and `integrity`
* A preferred `Re-verify as <actor>` quick fix is offered on drifted concepts

## Bug Fixes

* The already-verified check now agrees with the CLI, treating a superseded entry as not verified
* A `verified` value written as a bare mapping is accepted
