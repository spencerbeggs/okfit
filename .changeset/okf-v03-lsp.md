---
"@okfit/lsp": minor
---

## Breaking Changes

The `status` of a concept on the `okfit/concepts` wire changed meaning. It was the typed `Status`, `undefined` when the concept wrote none or a value outside the vocabulary. It is now the derived status (OKF 0.3 section 5.4): `"stable"` for an absent, `null` or empty status, and the new `"unknown"` for a value outside the vocabulary (the text is in `rawStatus`). A client built against the previous server that reads an absent `status` as "none written" must use `explicitStatus` instead; `ConceptSummary.status` is typed `DerivedStatus` rather than `Status | undefined`.

## Features

- An unknown status is shown with its raw value; verify actions and the verify-and-mark-stable command refuse it.
- Concept summaries carry a derived `status` and `rawStatus`, and `explicitStatus`, whether the concept writes a `status` at all.
- Repository resources are bounded by the project root; a value outside it is shown as an `info` diagnostic.
